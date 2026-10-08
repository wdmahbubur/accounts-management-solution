"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CompanySetup, CompleteSetupReceipt, OpeningMode } from "../../../../../server/onboarding/setup.ts";

const repairLinks: Record<string, { path: string; label: string }> = {
  account_mappings: { path: "/accounting/accounts", label: "Review chart and mappings" },
  fiscal_calendar: { path: "/accounting/periods", label: "Review fiscal periods" },
  opening_period: { path: "/accounting/periods", label: "Review fiscal periods" },
  cash_account: { path: "/banking/accounts", label: "Set up cash and bank accounts" },
  invoice_policy: { path: "/settings/approvals", label: "Configure approval policies" },
  receipt_policy: { path: "/settings/approvals", label: "Configure approval policies" },
  purchase_policies: { path: "/settings/approvals", label: "Configure approval policies" }
};

export function CompanySetupForm({ setup, nonce }: { setup: CompanySetup; nonce: string }) {
  const router = useRouter();
  const requestKey = useRef(crypto.randomUUID());
  const requestPending = useRef(false);
  const [mode, setMode] = useState<OpeningMode | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<CompleteSetupReceipt | null>(null);
  const root = `/o/${setup.organizationId}`;
  const selected = setup.openingDocuments.find(document => document.id === documentId);
  const requiredReady = setup.checks.filter(check => check.required).every(check => check.ready);
  const ready = requiredReady && (mode === "zero_opening" ? confirmed && setup.zeroOpeningAvailable :
    mode === "import_opening" && selected?.state === "approved" && selected.hasCutoverSummary);
  const active = setup.status === "active" || receipt !== null;

  function changed() { requestKey.current = crypto.randomUUID(); setError(""); }
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${setup.organizationId}/setup/complete`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": `setup-${crypto.randomUUID()}`, "Idempotency-Key": requestKey.current },
        body: JSON.stringify({ opening_mode: mode, zero_opening_confirmed: mode === "zero_opening" && confirmed,
          opening_document_id: mode === "import_opening" ? selected?.id : null,
          expected_document_version: mode === "import_opening" ? selected?.version : null })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.fields?.setup ?? json?.error?.message ?? "Setup could not be completed. Refresh the checks and try again.");
      if (json.data?.status !== "active" || json.data?.organizationId !== setup.organizationId) throw new Error("The completion response was not confirmed. Retry the same choice.");
      setReceipt(json.data as CompleteSetupReceipt);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Setup could not be completed. Retry the same choice."); }
    finally { requestPending.current = false; setBusy(false); }
  }

  return <main className="content" data-company-context={nonce}>
    <p className="eyebrow">Company settings · {setup.name}</p><h1>{active ? "Your books are active" : "Finish setting up your books"}</h1>
    <p>Books start on <strong>{setup.booksStartDate}</strong>. Any imported opening balances belong to <strong>{setup.cutoverDate}</strong>. All amounts are in BDT.</p>
    {error && <p role="alert" className="alert">{error}</p>}
    {active ? <section className="panel"><h2>Setup complete</h2>
      <p>{(receipt?.openingMode ?? setup.completion?.openingMode) === "zero_opening" ? "These books started with a recorded zero opening position. No opening journal was created." :
        (receipt?.openingMode ?? setup.completion?.openingMode) === "import_opening" ? "The selected opening balances and company activation were committed together." : "This company is already active. Its existing books have been preserved."}</p>
      {(receipt?.openingDocumentId ?? setup.completion?.openingDocumentId) && <p><Link href={`${root}/accounting/documents/${receipt?.openingDocumentId ?? setup.completion?.openingDocumentId}`}>View the posted opening document{receipt?.openingDocumentNumber ? ` · ${receipt.openingDocumentNumber}` : ""}</Link></p>}
      <div className="toolbar"><Link href={`${root}/sales/invoices`}>Open invoices</Link><Link href={`${root}/dashboard`}>Open dashboard</Link></div>
    </section> : setup.status !== "onboarding" ? <section className="panel"><h2>Books are {setup.status.replaceAll("_", " ")}</h2><p>Initial setup cannot reactivate a read-only or archived company.</p></section> : <>
      <section className="panel"><h2>1. Check the foundations</h2><ul>{setup.checks.filter(check => check.required).map(check => <li key={check.code}>
        <strong>{check.ready ? "Ready" : "Needs attention"}</strong> · {check.message} {!check.ready && repairLinks[check.code] && <Link href={`${root}${repairLinks[check.code].path}`}>{repairLinks[check.code].label}</Link>}
      </li>)}</ul></section>
      <form onSubmit={event => void complete(event)}><fieldset disabled={busy} className="panel">
        <legend><strong>2. Choose the opening position</strong></legend>
        <p>The opening position cannot be replaced after setup. Later corrections retain the original evidence.</p>
        <label><input type="radio" name="opening_mode" value="zero_opening" checked={mode === "zero_opening"} disabled={!setup.zeroOpeningAvailable}
          onChange={() => { changed(); setMode("zero_opening"); }} /> Start fresh with no opening balances</label>
        <p>Use this only when there are no earlier balances, customer or supplier dues, advances, or imported year-to-date activity.</p>
        {!setup.zeroOpeningAvailable && <p>An opening document or accounting history already exists. Resume that cutover below.</p>}
        {mode === "zero_opening" && <label><input type="checkbox" checked={confirmed} onChange={event => { changed(); setConfirmed(event.target.checked); }} /> I confirm there are no balances or outstanding items before {setup.booksStartDate}.</label>}
        <label><input type="radio" name="opening_mode" value="import_opening" checked={mode === "import_opening"} onChange={() => { changed(); setMode("import_opening"); }} /> Bring forward existing balances</label>
        {mode === "import_opening" && <div>
          <p>Prepare the prior trial balance and detailed customer, supplier and advance items, then approve that opening document through the existing review workflow.</p>
          <p><Link href={`${root}/settings/opening-balances`}>{setup.openingDocuments.length ? "Open the cutover workspace" : "Prepare opening balances"}</Link> · <Link href={`${root}/settings/approvals`}>Configure opening approval</Link> · <Link href={`${root}/approvals`}>Review approval requests</Link></p>
          <label>Approved opening document<select value={documentId} onChange={event => { changed(); setDocumentId(event.target.value); }}>
            <option value="">Choose an approved opening document</option>{setup.openingDocuments.filter(document => document.state === "approved" && document.hasCutoverSummary).map(document =>
              <option key={document.id} value={document.id}>{document.description || "Opening balances"} · {document.accountingDate} · BDT {document.totalAmount}</option>)}
          </select></label>
          {selected && <p>Completing setup will post <strong>BDT {selected.totalAmount}</strong> dated {selected.accountingDate}. <Link href={`${root}/accounting/documents/${selected.id}`}>Review this document</Link></p>}
        </div>}
        <p><button type="submit" disabled={busy || !ready}>{busy ? "Completing setup…" : mode === "import_opening" ? "Complete setup and post opening balances" : "Complete company setup"}</button></p>
        {!requiredReady && <p role="status">Resolve the foundation checks before completing setup.</p>}
      </fieldset></form>
    </>}
    {!active && setup.openingDocuments.length > 0 && <section className="panel"><h2>Opening work in progress</h2><ul>{setup.openingDocuments.map(document => <li key={document.id}>
      {document.description || "Opening balances"} · BDT {document.totalAmount} · {document.state.replaceAll("_", " ")} · <Link href={`${root}/accounting/documents/${document.id}`}>Review</Link>
      {document.state === "draft" && <> · <Link href={`${root}/settings/opening-balances?document=${document.id}`}>Resume editing</Link></>}
    </li>)}</ul></section>}
    <section className="panel"><h2>Before your first transactions</h2><p>Activation preserves every posting and approval check. Complete the configuration needed for the work you plan to do next.</p>
      <ul>{setup.checks.filter(check => !check.required).map(check => <li key={check.code}><strong>{check.ready ? "Configured" : "To do"}</strong> · {check.message} {!check.ready && <Link href={`${root}${repairLinks[check.code].path}`}>{repairLinks[check.code].label}</Link>}</li>)}</ul>
      <p>Self approval is available only when explicitly configured for a sole active owner.</p>
    </section>
  </main>;
}
