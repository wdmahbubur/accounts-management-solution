import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { browserApi, companyNonce, localStack, openCompany } from "./support/local-auth.ts";

async function signIn(page: Page, user: { email: string; password: string }, next: string) {
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
}

test("US-010 verified invitation lifecycle and S-07/S-14 live command and actual private-byte revocation", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const stack = localStack();
  const owner = await stack.user("us010-owner", "Invitation Owner");
  const recipient = await stack.user("us010-recipient", "Invitation Recipient");
  const rejecter = await stack.user("us010-rejecter", "Invitation Rejecter");
  const company = async (name: string, key: string) => {
    const result = await owner.client.rpc("create_company_atomic", {
      p_name: name, p_legal_name: name, p_country_code: "BD", p_base_currency: "BDT", p_timezone: "Asia/Dhaka",
      p_fiscal_year_start_month: 1, p_books_start_date: "2026-04-01", p_idempotency_key: key
    });
    expect(result.error).toBeNull(); const id = result.data[0].organization_id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/i); return id;
  };
  const org = await company("Invitation Company", "us010_company_a_0123456789");
  const otherOrg = await company("Invitation Other Company", "us010_company_b_0123456789");
  // Deliberately explicit combined role; default Admin/Billing must not get these grants.
  const capabilities = ["company.read", "users.read", "users.manage", "sales.read", "attachments.read", "attachments.write",
    "exports.read", "reports.export", "reports.read", "accounting.read", "ledger.read"];
  const custom = await owner.client.rpc("create_custom_role", { p_organization_id: org, p_name: "Evidence reviewer",
    p_permission_codes: capabilities, p_request_id: "req_us010_browser_role" });
  expect(custom.error).toBeNull(); const roleId = custom.data as string; expect(roleId).toMatch(/^[0-9a-f-]{36}$/i);
  const context = await browser.newContext(); const page = await context.newPage();
  await openCompany(page, owner, "Invitation Company");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  const createForm = page.getByRole("form", { name: "Create invitation", exact: true });
  await createForm.getByLabel("Recipient email", { exact: true }).fill(recipient.email);
  await createForm.getByRole("combobox", { name: "Proposed role", exact: true }).selectOption(roleId);
  await createForm.getByRole("button", { name: "Create invitation", exact: true }).click();
  const link = createForm.getByRole("link", { name: "One-time invitation link", exact: true });
  await expect(link).toBeVisible(); const oldPath = (await link.getAttribute("href"))!;
  expect(oldPath).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  const directory = await browserApi(page, `/api/v1/organizations/${org}/invitations`);
  expect(directory.status).toBe(200);
  const invitationId = directory.body.data.find((i: { email: string }) => i.email === recipient.email).id as string;
  expect(invitationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(JSON.stringify(directory.body)).not.toContain("token_hash");
  expect(JSON.stringify(directory.body)).not.toContain(oldPath.split("/").at(-1));
  const managementHeaders = { "x-company-context": await companyNonce(page) };
  const quickResend = await browserApi(page, `/api/v1/organizations/${org}/invitations/${invitationId}/resend`, { method: "POST", headers: managementHeaders, data: {} });
  expect(quickResend.status).toBe(429);
  const forged = await browserApi(page, `/api/v1/organizations/${org}/invitations`, { method: "POST", headers: managementHeaders,
    data: { email: "forged@example.invalid", role_id: roleId, actor_id: recipient.id } });
  expect(forged.status).toBe(422);
  const wrong = await context.newPage(); await wrong.goto(oldPath);
  await expect(wrong.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  await expect(wrong.getByText("Evidence reviewer", { exact: true })).not.toBeVisible();
  await wrong.close();

  // Fixture ages only the rate-limit timestamp; application still rotates the token.
  stack.sql(`update finance.invitations set last_issued_at=now()-interval '61 seconds' where id='${invitationId}';`);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: recipient.email, exact: true }) });
  await card.getByRole("button", { name: `Resend invitation to ${recipient.email}`, exact: true }).click();
  const replacement = card.getByRole("link", { name: "One-time invitation link", exact: true });
  await expect(replacement).toBeVisible(); const newPath = (await replacement.getAttribute("href"))!;
  expect(newPath).not.toBe(oldPath);
  await page.screenshot({ path: testInfo.outputPath("us010-invitations-desktop.png"), fullPage: true });
  const recipientContext = await browser.newContext(); const invited = await recipientContext.newPage();
  await signIn(invited, recipient, oldPath);
  await expect(invited.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  stack.sql(`update auth.users set email_confirmed_at=NULL where id='${recipient.id}';`);
  await invited.goto(newPath);
  await expect(invited.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  stack.sql(`update auth.users set email_confirmed_at=now() where id='${recipient.id}';`);
  await invited.goto(newPath);
  await expect(invited.getByRole("heading", { name: "Join Invitation Company", exact: true })).toBeVisible();
  await expect(invited.getByText("Evidence reviewer", { exact: true })).toBeVisible();
  await invited.setViewportSize({ width: 390, height: 844 });
  await invited.screenshot({ path: testInfo.outputPath("us010-invitation-mobile.png"), fullPage: true });
  await expect.poll(() => invited.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await invited.getByLabel("I confirm the proposed company and role.", { exact: true }).check();
  await invited.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(invited.getByRole("status")).toContainText("Invitation accepted");
  const token = newPath.split("/").at(-1)!;
  const reused = await browserApi(invited, "/api/v1/invitations/respond", { method: "POST", data: { token, decision: "accept" } });
  expect(reused.status).toBe(404);
  const acceptedMember = stack.sql(`select id from finance.organization_members where organization_id='${org}' and user_id='${recipient.id}';`);
  expect(acceptedMember).toMatch(/^[0-9a-f-]{36}$/i);
  await invited.getByRole("link", { name: "Go to companies", exact: true }).click();
  await invited.getByRole("button", { name: "Open Invitation Company", exact: true }).click();
  await expect(invited.getByRole("heading", { name: "Invitation Company", exact: true })).toBeVisible();
  expect((await browserApi(invited, `/api/v1/organizations/${org}/invitations`)).status).toBe(200);

  // Actual Storage objects, synthetic bytes, ordinary recipient JWT for all reads.
  const attachment = randomUUID(), exportId = randomUUID(), otherAttachment = randomUUID();
  const ar = randomUUID(), ap = randomUUID();
  const attachmentKey = `${org}/attachments/${attachment}`, exportKey = `${org}/exports/${exportId}`;
  const otherKey = `${otherOrg}/attachments/${otherAttachment}`;
  const evidence = "US010 SYNTHETIC PRIVATE EVIDENCE", exported = "US010 SYNTHETIC EXPORT BYTES";
  const hash = createHash("sha256").update(evidence).digest("hex");
  const otherOwner = stack.sql(`select id from finance.organization_members where organization_id='${otherOrg}' and user_id='${owner.id}';`);
  stack.sql(`insert into finance.attachments(id,organization_id,object_key,original_filename,content_type,byte_size,sha256,scan_status,uploaded_by_member_id) values
    ('${attachment}','${org}','${attachmentKey}','receipt.txt','text/plain',${Buffer.byteLength(evidence)},'${hash}','clean','${acceptedMember}'),
    ('${otherAttachment}','${otherOrg}','${otherKey}','other.txt','text/plain',${Buffer.byteLength(evidence)},'${hash}','clean','${otherOwner}');
    insert into finance.business_documents(id,organization_id,document_type,issue_date,accounting_date,created_by_member_id) values
    ('${ar}','${org}','invoice','2026-04-01','2026-04-01','${acceptedMember}'),
    ('${ap}','${org}','bill','2026-04-01','2026-04-01','${acceptedMember}');
    insert into finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id) values('${org}','${attachment}','${ar}','${acceptedMember}');
    insert into finance.export_jobs(id,organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format,status,object_key,expires_at)
    values('${exportId}','${org}','${acceptedMember}','trial_balance','{}',now(),'csv','completed','${exportKey}',now()+interval '1 hour');`);
  await stack.uploadPrivateFixture(attachmentKey, evidence); await stack.uploadPrivateFixture(exportKey, exported); await stack.uploadPrivateFixture(otherKey, evidence);
  const storage = recipient.client.storage.from("ams-private-artifacts");
  const initialJwt = (await recipient.client.auth.getSession()).data.session!.access_token;
  const direct = await storage.download(attachmentKey); expect(direct.error).toBeNull(); expect(await direct.data!.text()).toBe(evidence);
  expect((await storage.createSignedUrl(attachmentKey, 3600)).error).not.toBeNull();
  expect((await storage.list(org)).data ?? []).toHaveLength(0);
  expect((await storage.download(otherKey)).error).not.toBeNull();
  const publicAccess = await fetch(stack.publicArtifactUrl(attachmentKey)); expect(publicAccess.ok).toBe(false);
  const bytes = (url: string) => invited.evaluate(async (url) => { const response = await fetch(url, { credentials: "same-origin" });
    return { status: response.status, body: await response.text(), cache: response.headers.get("cache-control"), type: response.headers.get("content-type") };
  }, url);
  const attachmentApi = `/api/v1/organizations/${org}/attachments/${attachment}/download`;
  const exportApi = `/api/v1/organizations/${org}/exports/${exportId}/download`;
  const allowed = await bytes(attachmentApi); expect(allowed.status).toBe(200); expect(allowed.body).toBe(evidence); expect(allowed.cache).toContain("no-store");
  const report = await bytes(exportApi); expect(report.status).toBe(200); expect(report.body).toBe(exported);
  expect((await bytes(`/api/v1/organizations/${otherOrg}/attachments/${otherAttachment}/download`)).status).toBe(404);
  // A file linked to an unreadable AP document cannot be laundered via an AR link.
  stack.sql(`insert into finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id) values('${org}','${attachment}','${ap}','${acceptedMember}');`);
  expect((await bytes(attachmentApi)).status).toBe(404); expect((await storage.download(attachmentKey)).error).not.toBeNull();
  stack.sql(`delete from finance.attachment_links where organization_id='${org}' and attachment_id='${attachment}' and document_id='${ap}';
    update finance.attachments set scan_status='pending' where id='${attachment}';`);
  expect((await bytes(attachmentApi)).status).toBe(404);
  stack.sql(`update finance.attachments set scan_status='clean' where id='${attachment}'; update finance.export_jobs set expires_at=now()-interval '1 second' where id='${exportId}';`);
  expect((await bytes(exportApi)).status).toBe(404);
  stack.sql(`update finance.export_jobs set expires_at=now()+interval '1 hour' where id='${exportId}';`);
  expect((await bytes(attachmentApi)).body).toBe(evidence); expect((await bytes(exportApi)).body).toBe(exported);
  const reduced = await owner.client.rpc("update_custom_role", { p_organization_id: org, p_role_id: roleId,
    p_name: "Evidence reviewer", p_permission_codes: capabilities.filter((code) => code !== "exports.read"), p_request_id: "req_us010_remove_export" });
  expect(reduced.error).toBeNull();
  expect((await bytes(exportApi)).status).toBe(404); expect((await storage.download(exportKey)).error).not.toBeNull();
  expect((await bytes(attachmentApi)).body).toBe(evidence);
  const restored = await owner.client.rpc("update_custom_role", { p_organization_id: org, p_role_id: roleId,
    p_name: "Evidence reviewer", p_permission_codes: capabilities, p_request_id: "req_us010_restore_export" });
  expect(restored.error).toBeNull(); expect((await bytes(exportApi)).body).toBe(exported);
  await page.reload();
  const memberCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Invitation Recipient", exact: true }) });
  await memberCard.getByText("Remove Invitation Recipient's access", { exact: true }).click();
  const removal = memberCard.getByRole("form", { name: "Deactivate Invitation Recipient", exact: true });
  await removal.getByLabel("I understand this removes company access immediately and keeps the audit identity.", { exact: true }).check();
  await removal.getByRole("button", { name: "Deactivate Invitation Recipient", exact: true }).click();
  await expect(memberCard.getByText("Inactive", { exact: true })).toBeVisible();
  expect((await recipient.client.auth.getUser(initialJwt)).error).toBeNull();
  expect((await recipient.client.auth.getSession()).data.session!.access_token === initialJwt).toBe(true);
  expect((await storage.download(attachmentKey)).error).not.toBeNull(); expect((await storage.download(exportKey)).error).not.toBeNull();
  expect((await bytes(attachmentApi)).status).toBe(404); expect((await bytes(exportApi)).status).toBe(404);
  expect((await browserApi(invited, `/api/v1/organizations/${org}/invitations`)).status).toBe(404);
  const staleCommand = await browserApi(invited, `/api/v1/organizations/${org}/invitations`, {
    method: "POST", headers: { "x-company-context": await companyNonce(invited) }, data: { email: "removed-attempt@example.invalid", role_id: roleId }
  });
  expect(staleCommand.status).toBe(404);
  expect(stack.sql(`select count(*) from finance.audit_events where actor_member_id='${acceptedMember}' and action='invitations.accepted';`)).toBe("1");
  expect(stack.sql(`select status from finance.organization_members where id='${acceptedMember}';`)).toBe("inactive");

  // Recipient rejection and issuer revocation are real UI paths, not only fixtures.
  const issued = await browserApi(page, `/api/v1/organizations/${org}/invitations`, { method: "POST", headers: { "x-company-context": await companyNonce(page) }, data: { email: rejecter.email, role_id: roleId } });
  expect(issued.status).toBe(200);
  const rejectContext = await browser.newContext(); const rejectPage = await rejectContext.newPage();
  await signIn(rejectPage, rejecter, issued.body.data.invitationPath);
  await rejectPage.getByRole("button", { name: "Reject invitation", exact: true }).click();
  await expect(rejectPage.getByRole("status")).toContainText("Invitation rejected");
  expect(stack.sql(`select count(*) from finance.organization_members where organization_id='${org}' and user_id='${rejecter.id}';`)).toBe("0");
  const revoked = await browserApi(page, `/api/v1/organizations/${org}/invitations`, { method: "POST", headers: { "x-company-context": await companyNonce(page) }, data: { email: rejecter.email, role_id: roleId } });
  expect(revoked.status).toBe(200);
  await page.reload();
  const pendingCard = page.locator("article").filter({ has: page.getByRole("heading", { name: rejecter.email, exact: true }) }).filter({ hasText: "pending" });
  await pendingCard.locator("summary").filter({ hasText: `Revoke invitation to ${rejecter.email}` }).click();
  const revokeForm = pendingCard.getByRole("form", { name: `Revoke invitation to ${rejecter.email}`, exact: true });
  await revokeForm.getByLabel("I confirm this link should stop working.", { exact: true }).check();
  await revokeForm.getByRole("button", { name: `Revoke invitation to ${rejecter.email}`, exact: true }).click();
  await expect.poll(() => stack.sql(`select status from finance.invitations where id='${revoked.body.data.invitationId}';`)).toBe("revoked");
  await rejectPage.goto(revoked.body.data.invitationPath);
  await expect(rejectPage.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
  await rejectContext.close(); await recipientContext.close(); await context.close();
});
