import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import argon2 from "argon2";
import { createAccountingFixture } from "./helpers/accounting-fixture.mjs";
import { bankScenario, creditScenario, reverseArgs, reverseSql } from "./helpers/reversal-dependencies.mjs";
import { createHash } from "node:crypto";
import { readPrivateObject } from "../../apps/web/server/storage/private.ts";

test("real Auth.js sessions enforce tenant, capability, metadata and request-origin boundaries", { timeout: 600_000 }, async t => {
  const base = process.env.AMS_TEST_APP_URL;
  assert.ok(base && ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001"].includes(base), "Explicitly select the locally started isolated application.");
  const f = await createAccountingFixture();
  const password = randomBytes(24).toString("base64url"), encoded = await argon2.hash(password);
  await f.admin.query("UPDATE identity.users SET password_hash=$1 WHERE id=ANY($2::uuid[])", [encoded, Object.values(f.ids)]);
  function session(organizationId=f.org) {
    const cookies = new Map();
    // Seed only the UI context cookies; actual identity and authority still
    // come from the password-authenticated session and live membership.
    const nonce = randomBytes(16).toString("base64url");
    cookies.set("ams_current_organization", organizationId); cookies.set("ams_company_context", nonce);
    return async (path, options = {}) => {
      const headers = new Headers(options.headers); if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      if (!headers.has("x-company-context")) headers.set("x-company-context", nonce);
      const response = await fetch(`${base}${path}`, { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(75_000) });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";", 1)[0], i = pair.indexOf("="); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
      return response;
    };
  }
  async function login(user,organizationId=f.org) {
    const send = session(organizationId); const csrf = await (await send("/api/auth/csrf")).json();
    const response = await send("/api/auth/callback/credentials", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: `acceptance-${user}@example.invalid`, password, callbackUrl: base }) });
    assert.ok([200, 302, 303].includes(response.status));
    const identity = await (await send("/api/auth/session")).json(); assert.equal(identity.user?.id, user, "Actual password authentication must establish the expected identity.");
    return send;
  }
  const api = (org, path) => `/api/v1/organizations/${org}/${path}`;
  const report = api(f.org, "reports/trial-balance?as_of=2025-12-31");
  let owner, billing, foreign, doc;
  try {
    owner = await login(f.ids.owner); billing = await login(f.ids.billing); foreign = await login(f.ids.outsider);
    doc = await f.posted(f.body("invoice", "123.00"));
    await t.test("S-01/S-03/S-05 direct report and source APIs enforce live ordinary-user permissions", async () => {
      const allowed = await owner(report); assert.equal(allowed.status, 200, JSON.stringify(await allowed.clone().json())); assert.match(allowed.headers.get("cache-control"), /private.*no-store/);
      assert.equal((await allowed.json()).meta.balanced, true);
      for (const send of [billing, foreign, session()]) {
        const response = await send(report); assert.ok([401, 403, 404].includes(response.status)); assert.equal((await response.json()).data, undefined);
      }
      const response = await foreign(api(f.org, `documents/${doc.document_id}`)); assert.equal(response.status, 404); assert.equal((await response.json()).data, undefined);
    });
    await t.test('concurrent authenticated reads keep ordinary-role authorization isolated',async()=>{
      for(let round=0;round<3;round++){
        const responses=await Promise.all([owner(report),billing(report),foreign(report)]);
        assert.equal(responses[0].status,200);assert.equal(responses[1].status,403);assert.equal(responses[2].status,404);
        assert.equal((await responses[0].json()).meta.balanced,true);for(const denied of responses.slice(1))assert.equal((await denied.json()).data,undefined);
      }
    });
    await t.test("S-04 forged Owner metadata cannot change an authenticated Billing user's authority", async () => {
      const response = await billing(api(f.org, "roles"), { method: "POST", headers: { "content-type": "application/json", origin: base, "idempotency-key": randomUUID() }, body: JSON.stringify({ name: "Forged Owner", user_metadata: { role: "Owner" }, actor_id: f.ids.owner, capabilities: ["*"] }) });
      assert.ok([400, 403, 422].includes(response.status), JSON.stringify(await response.json())); assert.ok([403, 404].includes((await billing(report)).status));
    });
    await t.test('company currency cannot be overridden through an authenticated document API',async()=>{
      const before=(await f.admin.query('SELECT count(*)::integer AS n FROM finance.business_documents WHERE organization_id=$1',[f.org])).rows[0].n;
      const response=await owner(api(f.org,'documents'),{method:'POST',headers:{'content-type':'application/json',origin:base,'idempotency-key':randomUUID()},body:JSON.stringify(f.body('invoice','1.00',{currency:'USD'}))});
      assert.equal(response.status,422,JSON.stringify(await response.clone().json()));
      assert.equal((await f.admin.query('SELECT count(*)::integer AS n FROM finance.business_documents WHERE organization_id=$1',[f.org])).rows[0].n,before);
    });
    await t.test("cookie-authenticated financial commands reject an untrusted Origin", async () => {
      const before = (await f.admin.query("SELECT count(*)::integer AS n FROM finance.business_documents WHERE organization_id=$1", [f.org])).rows[0].n;
      const response = await owner(api(f.org, "documents"), { method: "POST", headers: { "content-type": "text/plain", origin: "https://untrusted.example.invalid", "sec-fetch-site": "cross-site", "idempotency-key": randomUUID() }, body: JSON.stringify(f.body("invoice", "1.00")) });
      assert.equal(response.status, 403);
      assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.business_documents WHERE organization_id=$1", [f.org])).rows[0].n, before);
      const trusted = await owner(api(f.org, "documents"), { method: "POST", headers: { "content-type": "application/json", origin: base, "idempotency-key": randomUUID() }, body: JSON.stringify(f.body("invoice", "1.00")) });
      assert.equal(trusted.status, 200); assert.match(trusted.headers.get("cache-control"), /private.*no-store/);
    });
    await t.test("T-44 real authenticated HTTP queues the displayed PDF snapshot and replays the same job", async () => {
      const filters={from:'2025-01-01',to:'2025-01-31'};
      const snapshot=(await f.rpc('SELECT public.capture_report_export_snapshot($1,\'profit_and_loss\',$2::jsonb) AS value',[f.org,JSON.stringify(filters)])).rows[0].value;
      const options={method:'POST',headers:{'content-type':'application/json',origin:base,'idempotency-key':randomUUID()},body:JSON.stringify({export_type:'profit_and_loss',format:'pdf',snapshot_id:snapshot.snapshot_id,...filters})};
      const response=await owner(api(f.org,'exports'),options);
      assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
      const first=(await response.json()).data;assert.equal(first.format,'pdf');assert.equal(first.status,'queued');assert.equal(first.ledger_cutoff_at,snapshot.ledger_cutoff_at);
      const replay=await owner(api(f.org,'exports'),options);assert.equal(replay.status,200);assert.equal((await replay.json()).data.id,first.id);
      for(const send of[billing,foreign])assert.ok([403,404].includes((await send(api(f.org,'exports'),options)).status));
    });
    await t.test("T-42 real HTTP finalizes cash flow and exports the selected immutable review",async()=>{
      const review=(await f.rpc("SELECT public.read_cash_flow_review($1,'2025-01-01','2025-01-31',NULL) AS value",[f.org])).rows[0].value;
      const options={method:'POST',headers:{'content-type':'application/json',origin:base,'idempotency-key':randomUUID()},body:JSON.stringify({from:'2025-01-01',to:'2025-01-31',expected_digest:review.material_digest})};
      const response=await owner(api(f.org,'reports/cash-flow/finalize'),options);
      assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const id=(await response.json()).data.finalization_id;
      const download=await owner(api(f.org,`reports/cash_flow?from=2025-01-01&to=2025-01-31&finalization=${id}&format=json`));
      assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(download.headers.get('cache-control'),/private.*no-store/);
      const saved=await download.json();assert.equal(saved.meta.finalization_id,id);
      const stored=(await f.rpc("SELECT public.read_cash_flow_review($1,'2025-01-01','2025-01-31',$2) AS value",[f.org,id])).rows[0].value;
      assert.deepEqual(saved.data,stored.snapshot.data);assert.deepEqual({...saved.data,cutoff_at:review.snapshot.data.cutoff_at},review.snapshot.data);
      for(const send of[billing,foreign])assert.ok([403,404].includes((await send(api(f.org,'reports/cash-flow/finalize'),options)).status));
    });
    await t.test('deferred SaaS billing remains authenticated, permission checked and unable to create paid state',async()=>{
      const response=await owner(api(f.org,'subscription'));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.match(response.headers.get('cache-control'),/private.*no-store/);
      const state=(await response.json()).data;assert.equal(state.active_members,4);assert.equal(state.subscription,null);assert.deepEqual(state.billing,{enabled:false,provider:'disabled'});
      for(const send of[billing,foreign,session()])assert.ok([401,403,404].includes((await send(api(f.org,'subscription'))).status));
      const options={method:'POST',headers:{'content-type':'application/json',origin:base,'idempotency-key':randomUUID()},body:'{}'};
      for(let retry=0;retry<2;retry++){const result=await owner(api(f.org,'subscription/checkout'),options);assert.equal(result.status,409);assert.equal((await result.json()).error.code,'BILLING_DISABLED');}
      for(const send of[billing,foreign])assert.ok([403,404].includes((await send(api(f.org,'subscription/checkout'),options)).status));
      assert.equal((await owner(api(f.org,'subscription/checkout'),{...options,body:JSON.stringify({price:'0.01',status:'active'})})).status,422);
    });
    await t.test('disabled billing webhooks never acknowledge activation or change company books',async()=>{
      const before=(await f.admin.query('SELECT count(*)::integer AS n FROM finance.journal_entries WHERE organization_id=$1',[f.org])).rows[0].n;
      for(let retry=0;retry<2;retry++){const result=await fetch(`${base}/api/v1/webhooks/billing/synthetic`,{method:'POST',headers:{'content-type':'application/json','x-signature':'forged'},body:JSON.stringify({organization_id:f.org,status:'active'})});assert.equal(result.status,503);assert.equal((await result.json()).error.code,'BILLING_DISABLED');}
      const counts=(await f.admin.query('SELECT (SELECT count(*) FROM finance.subscriptions WHERE organization_id=$1)::integer AS subscriptions,(SELECT count(*) FROM finance.billing_events WHERE organization_id=$1)::integer AS billing_events,(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1)::integer AS journals',[f.org])).rows[0];assert.deepEqual(counts,{subscriptions:0,billing_events:0,journals:before});
    });
    await t.test("real authenticated reversal API permits resolved bank history and preserves replay and authorization", async () => {
      const b = await bankScenario(f), matches = [await b.add(b.statements[0]), await b.add(b.statements[1])];
      const path = api(f.org, `documents/${b.receipt.document_id}/reverse`), key = randomUUID();
      const options = { method: "POST", headers: { "content-type": "application/json", origin: base, "idempotency-key": key }, body: JSON.stringify({ reversal_date: "2025-01-20", reason: "Synthetic API correction of resolved bank history" }) };
      assert.equal((await owner(path, options)).status, 409);
      await b.unmatch(matches[0]); await b.unmatch(matches[1]);
      assert.equal((await billing(path, options)).status, 403);
      const response = await owner(path, options); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const receipt = await response.json(), replay = await owner(path, options);
      assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).data, receipt.data);
    });
    await t.test("real authenticated reversal API respects the linked credit reversal's effective date", async () => {
      const { original, credit } = await creditScenario(f, "customer_credit");
      await f.rpc(reverseSql, reverseArgs(f, credit, "2025-01-20"));
      const path = api(f.org, `documents/${original.document_id}/reverse`);
      const options = date => ({ method: "POST", headers: { "content-type": "application/json", origin: base, "idempotency-key": randomUUID() }, body: JSON.stringify({ reversal_date: date, reason: "Synthetic API correction after child credit reversal" }) });
      const early = await owner(path, options("2025-01-19")); assert.equal(early.status, 409);
      const failure = await early.json(); assert.equal(failure.error.code, "REVERSAL_DEPENDENCY"); assert.match(failure.error.fields.reversal_date, /on or after/);
      const response = await owner(path, options("2025-01-20")); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    });
    await t.test("private upload APIs deny anonymous, foreign and stale-context storage writes, then complete one authorized upload", async () => {
      const draft = await f.save(f.body("invoice", "1.00")), bytes = new TextEncoder().encode("Synthetic HTTP evidence.");
      const body = { document_id: draft.document_id, filename: "http-evidence.txt", content_type: "text/plain", byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      const headers = { origin: base, "content-type": "application/json" };
      const intentPath = api(f.org, "attachments/upload-intents");
      assert.equal((await session()(intentPath, { method: "POST", headers, body: JSON.stringify(body) })).status, 401);
      const started = await owner(intentPath, { method: "POST", headers, body: JSON.stringify(body) }); assert.equal(started.status, 201, JSON.stringify(await started.clone().json()));
      const intent = (await started.json()).data, key = `${f.org}/attachments/${intent.intent_id}`;
      const upload = () => { const form = new FormData(); form.set("file", new File([bytes], "http-evidence.txt", { type: "text/plain" })); return { method: "POST", headers: { origin: base }, body: form }; };
      assert.equal(await readPrivateObject(key), null);
      assert.equal((await session()(intent.upload_url, upload())).status, 401);
      assert.equal((await foreign(intent.upload_url, upload())).status, 404);
      assert.ok([403, 404].includes((await billing(intent.upload_url, upload())).status));
      const stale = upload(); stale.headers["x-company-context"] = randomUUID(); assert.equal((await owner(intent.upload_url, stale)).status, 409);
      assert.equal(await readPrivateObject(key), null, "Denied HTTP requests cannot create even quarantined object bytes.");
      const completed = await owner(intent.upload_url, upload()); assert.equal(completed.status, 201, JSON.stringify(await completed.clone().json()));
      assert.equal((await completed.json()).data.attachment_id, intent.intent_id);
      assert.equal(createHash("sha256").update(await readPrivateObject(key)).digest("hex"), body.sha256);
      const replay = await owner(intent.upload_url, upload()); assert.equal(replay.status, 201);
      assert.equal((await replay.json()).data.attachment_id, intent.intent_id);
      assert.equal((await f.admin.query("SELECT count(*)::int AS n FROM finance.attachment_links WHERE organization_id=$1 AND attachment_id=$2", [f.org, intent.intent_id])).rows[0].n, 1);
    });
    await t.test("legacy cutover evidence writes reject foreign origin, stale company context and missing capability", async () => {
      const path=api(f.org,`documents/${doc.document_id}/opening-cutover`);
      const before=(await f.admin.query('SELECT count(*)::int AS n FROM finance_private.opening_cutover_summaries WHERE organization_id=$1',[f.org])).rows[0].n;
      const options={method:'POST',headers:{'content-type':'application/json',origin:base},body:'{}'};
      assert.equal((await owner(path,{...options,headers:{...options.headers,origin:'https://untrusted.example.invalid','sec-fetch-site':'cross-site'}})).status,403);
      assert.equal((await owner(path,{...options,headers:{...options.headers,'x-company-context':randomUUID()}})).status,409);
      assert.equal((await billing(path,options)).status,403);assert.equal((await foreign(path,options)).status,404);assert.equal((await session()(path,options)).status,401);
      assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance_private.opening_cutover_summaries WHERE organization_id=$1',[f.org])).rows[0].n,before);
    });
    await t.test('year close and reopen reject cross-origin, stale-context and unauthorized requests, then replay a genuine zero-nominal close',async()=>{
      const fiscalYear=(await f.rpc('SELECT id FROM finance.fiscal_years WHERE organization_id=$1 ORDER BY starts_on',[f.org])).rows[0].id;
      const before=(await f.admin.query('SELECT count(*)::int AS n FROM finance.year_close_runs WHERE organization_id=$1',[f.org])).rows[0].n;
      for(const action of['close','reopen']){
        const path=api(f.org,`fiscal-years/${fiscalYear}/${action}`),options={method:'POST',headers:{origin:base,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({reason:'Synthetic HTTP annual accounting control test'})};
        assert.equal((await owner(path,{...options,headers:{...options.headers,origin:'https://untrusted.example.invalid','sec-fetch-site':'cross-site'}})).status,403);
        assert.equal((await owner(path,{...options,headers:{...options.headers,'x-company-context':randomUUID()}})).status,409);
        assert.equal((await billing(path,options)).status,403);assert.equal((await foreign(path,options)).status,404);assert.equal((await session()(path,options)).status,401);
      }
      assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.year_close_runs WHERE organization_id=$1',[f.org])).rows[0].n,before);
      const z=await createAccountingFixture();
      try{
        await z.admin.query('UPDATE identity.users SET password_hash=$1 WHERE id=$2',[encoded,z.ids.owner]);
        const send=await login(z.ids.owner,z.org),year=(await z.rpc('SELECT id FROM finance.fiscal_years WHERE organization_id=$1 ORDER BY starts_on',[z.org])).rows[0].id;
        for(const p of(await z.rpc('SELECT * FROM finance.accounting_periods WHERE organization_id=$1 AND fiscal_year_id=$2 ORDER BY starts_on,id',[z.org,year])).rows)await z.rpc('SELECT public.lock_accounting_period($1,$2,$3,$4,$5)',[z.org,p.id,p.row_version,randomUUID(),'Synthetic HTTP zero-nominal close prerequisites']);
        for(const action of['close','reopen']){
          const path=api(z.org,`fiscal-years/${year}/${action}`),options={method:'POST',headers:{origin:base,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({reason:'Synthetic HTTP zero-nominal annual close rehearsal'})};
          const response=await send(path,options);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.match(response.headers.get('cache-control'),/private.*no-store/);
          const receipt=await response.json();assert.equal(receipt.data.close_kind,'zero_nominal');assert.equal(receipt.data.journal_entry_id,null);assert.equal(receipt.data[action==='close'?'document_id':'reopen_document_id'],null);assert.equal(receipt.meta.replayed,undefined);
          const replay=await send(path,options);assert.equal(replay.status,200);assert.deepEqual((await replay.json()).data,receipt.data);
        }
        const counts=(await z.admin.query('SELECT (SELECT count(*) FROM finance.business_documents WHERE organization_id=$1)::int AS documents,(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1)::int AS journals,(SELECT count(*) FROM finance.year_close_runs WHERE organization_id=$1 AND reopened_at IS NOT NULL)::int AS reopened',[z.org])).rows[0];assert.deepEqual(counts,{documents:0,journals:0,reopened:1});
      }finally{await z.close();}
    });
    await t.test("S-07 a still-valid authentication session loses company access immediately after deactivation", async () => {
      const member = (await f.admin.query("SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2", [f.org, f.ids.owner])).rows[0].id;
      await f.rpc("SELECT public.deactivate_member($1,$2,$3)", [f.org, member, `revoke-http-${randomUUID()}`], f.ids.checker);
      assert.equal((await (await owner("/api/auth/session")).json()).user.id, f.ids.owner, "The authentication session remains unexpired.");
      assert.equal((await owner(report)).status, 404); assert.equal((await owner(api(f.org, `documents/${doc.document_id}`))).status, 404);
      assert.equal((await owner(api(f.org,'subscription'))).status,404);
    });
    console.log(JSON.stringify({ fixture: "http-security", organizationId: f.org }));
  } finally { await f.close(); }
});
