"use client";
import { useState } from "react";
import { AccountPicker, FinanceInteractionBoundary, PartyPicker, AuditDrawer, ConfirmAction, DateRange, DocumentLineGrid, MoneyCell, MoneyInput, PostingPreview, StatusBadge, ViewState, type DraftLine } from "../../../components/finance/components.tsx";
export function UiFixtures() {
  const [amount, setAmount] = useState(""); const [account, setAccount] = useState(""); const [party, setParty] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ id: "line", description: "পরামর্শ সেবা", quantity: "0.125", unitPrice: "10.04" }]);
  const [range, setRange] = useState({ start: "2026-01-01", end: "2026-01-31" }); const [confirmed, setConfirmed] = useState(0);
  return <main className="management-shell"><h1>UI test fixtures — synthetic only</h1><p>No accounting mutation or customer data.</p>
    <MoneyInput name="amount" label="Amount" value={amount} onChange={setAmount} />
    <p>Exact display: <MoneyCell value="9007199254740993.17" /></p>
    <AccountPicker label="Account" name="account" organizationId="fixture" data={{ organizationId: "fixture", options: [{ id: "bank", label: "ব্যাংক · Bank" }] }} value={account} onChange={setAccount} />
    <PartyPicker label="Party" name="party" organizationId="fixture" data={{ organizationId: "fixture", options: [{ id: "party", label: "বাংলা কোম্পানি" }] }} value={party} onChange={setParty} />
    <DocumentLineGrid lines={lines} onChange={(id, field, value) => setLines((prior) => prior.map((l) => l.id === id ? { ...l, [field]: value } : l))} onRemove={(id) => setLines((prior) => prior.filter((l) => l.id !== id))} />
    <DateRange {...range} onChange={setRange} />
    <PostingPreview state="loading" />
    <PostingPreview state="ready" data={{ sourceVersion: 4, rows: [{ id: "preview-bank", accountLabel: "Synthetic bank", debit: "1.26", credit: "0.00" }, { id: "preview-revenue", accountLabel: "Synthetic revenue", debit: "0.00", credit: "1.26" }], totalDebit: "1.26", totalCredit: "1.26" }} />
    <StatusBadge status="draft" />
    <AuditDrawer allowed entries={[{ id: "audit", action: "Synthetic draft updated", actor: "Test User", time: "2026-01-01 10:00 UTC" }]} />
    <ConfirmAction label="Confirm fixture action" title="Confirm synthetic action" description="This changes only a local test counter." requestKey="fixture-stable-request-key" onConfirm={async () => { await new Promise((resolve) => setTimeout(resolve, 250)); setConfirmed((value) => value + 1); }} />
    <p>Confirmed actions: {confirmed}</p>
    <ConfirmAction label="Simulate uncertain response" title="Simulate a failure" description="This only tests failure feedback." requestKey="fixture-uncertain-request-key" onConfirm={async () => { throw new Error("Test failure"); }} />
    <FinanceInteractionBoundary readOnly><MoneyInput label="Read-only amount" name="readonly_amount" value="1.00" onChange={() => {}} /></FinanceInteractionBoundary>
    <ViewState kind="empty" /><ViewState kind="conflict" /><ViewState kind="forbidden" />
  </main>;
}
