"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Line = Record<string, unknown>;
function asRows(value: unknown): Line[] { return Array.isArray(value) ? value.filter((row): row is Line => !!row && typeof row === "object" && !Array.isArray(row)) : []; }
function toCents(value: unknown): bigint {
  const text = String(value ?? ""); const match = /^(-?)(\d+)\.(\d{2})$/.exec(text);
  if (!match) return 0n;
  const cents = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return match[1] ? -cents : cents;
}
function formatCents(value: bigint): string { const abs = value < 0n ? -value : value; return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`; }
function minAmount(a: unknown, b: unknown): string { const x = toCents(a); const y = toCents(b); const min = x < y ? x : y; return min > 0n ? formatCents(min) : "0.00"; }

export function ReconciliationWorkspace({ organizationId, data, canWrite }: { organizationId: string; data: Line; canWrite: boolean }) {
  const router = useRouter();
  const session = data.reconciliation as Line;
  const account = data.cash_account as Line;
  const bankLines = useMemo(() => asRows(data.statement_lines), [data.statement_lines]);
  const bookLines = useMemo(() => asRows(data.book_lines), [data.book_lines]);
  const matches = useMemo(() => asRows(data.matches), [data.matches]);
  const [statementId, setStatementId] = useState(""); const [journalId, setJournalId] = useState(""); const [amount, setAmount] = useState("0.00");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const statement = bankLines.find((row) => row.id === statementId); const book = bookLines.find((row) => row.id === journalId);
  async function saveMatch() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/reconciliations/${String(session.id)}/matches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statement_line_id: statementId, journal_line_id: journalId, amount }) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error?.fields?.match ?? json?.error?.message ?? "Could not match these lines.");
      setStatementId(""); setJournalId(""); setAmount("0.00"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not match these lines."); }
    finally { setBusy(false); }
  }
  async function reverse(matchId: string) {
    const reason = window.prompt("Reason for reversing this draft match?"); if (!reason?.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/reconciliations/${String(session.id)}/matches`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match_id: matchId, reason }) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error?.fields?.reason ?? json?.error?.message ?? "Could not reverse this match."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reverse this match."); }
    finally { setBusy(false); }
  }
  function chooseStatement(row: Line) { setStatementId(String(row.id)); if (book) setAmount(minAmount(row.remaining, book.remaining)); }
  function chooseBook(row: Line) { setJournalId(String(row.id)); if (statement) setAmount(minAmount(statement.remaining, row.remaining)); }
  const activeMatches = matches.filter((match) => match.reversed !== true);
  return <main className="content"><p className="eyebrow">Banking · Reconciliation</p><h1>{String(account.name)} statement match</h1><p>{String(session.starts_on)} to {String(session.ends_on)} · Opening {String(session.statement_opening)} · Closing {String(session.statement_closing)} BDT · {String(session.state)}</p><p>Matches associate statement evidence with posted ledger entries; they do not post money.</p><p><Link href={`/o/${organizationId}/banking/reconciliations`}>Start another reconciliation</Link></p>{error && <p role="alert">{error}</p>}
    <section className="panel"><h2>Match statement and book lines</h2><div className="table-scroll"><table><thead><tr><th>Statement row</th><th>Date</th><th>Description / reference</th><th>Amount</th><th>Matched</th><th>Remaining</th><th>Select</th></tr></thead><tbody>{bankLines.map((row) => <tr key={String(row.id)}><td>{String(row.row_no)}</td><td>{String(row.transaction_date)}</td><td>{String(row.description)}{row.reference ? ` · ${String(row.reference)}` : ""}{row.review_required === true && <strong> · Review fingerprint</strong>}{bookLines.some((candidate) => candidate.accounting_date === row.transaction_date && toCents(candidate.signed_amount) === toCents(row.amount)) && <strong> · Suggested match</strong>}</td><td>{String(row.amount)}</td><td>{String(row.matched)}</td><td>{String(row.remaining)}</td><td><button type="button" className="secondary" disabled={!canWrite || busy || toCents(row.remaining) <= 0n} aria-pressed={statementId === row.id} onClick={() => chooseStatement(row)}>{statementId === row.id ? "Selected" : "Select"}</button></td></tr>)}</tbody></table></div></section>
    <section className="panel"><h2>Posted cash book lines</h2>{bookLines.length === 0 ? <p>No posted cash lines in this statement date range.</p> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description / document</th><th>Debit</th><th>Credit</th><th>Signed</th><th>Matched</th><th>Remaining</th><th>Select</th></tr></thead><tbody>{bookLines.map((row) => <tr key={String(row.id)}><td>{String(row.accounting_date)}</td><td>{String(row.description)}{row.document_number ? ` · ${String(row.document_number)}` : ""}{row.reference ? ` · ${String(row.reference)}` : ""}</td><td>{String(row.debit)}</td><td>{String(row.credit)}</td><td>{String(row.signed_amount)}</td><td>{String(row.matched)}</td><td>{String(row.remaining)}</td><td><button type="button" className="secondary" disabled={!canWrite || busy || toCents(row.remaining) <= 0n} aria-pressed={journalId === row.id} onClick={() => chooseBook(row)}>{journalId === row.id ? "Selected" : "Select"}</button></td></tr>)}</tbody></table></div>}</section>
    {canWrite && session.state === "draft" && <section className="panel"><h2>Confirm selected match</h2><p>Statement: {String(statement?.description ?? "Choose a statement row")} · book: {String(book?.description ?? "Choose a book line")}</p><label>Amount to match (BDT)<input inputMode="decimal" pattern="[0-9]{1,12}\.[0-9]{2}" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button type="button" disabled={busy || !statement || !book || toCents(amount) <= 0n || (statement && book && ((toCents(statement.amount) < 0n) !== (toCents(book.signed_amount) < 0n)))} onClick={() => void saveMatch()}>{busy ? "Saving…" : "Add partial match"}</button></section>}
    <section className="panel"><h2>Active matches</h2>{!activeMatches.length ? <p>No statement lines matched yet.</p> : <ul>{activeMatches.map((match) => { const bank = bankLines.find((row) => row.id === match.statement_line_id); const ledger = bookLines.find((row) => row.id === match.journal_line_id); return <li key={String(match.id)}>{String(bank?.transaction_date)} · {String(bank?.description)} ↔ {String(ledger?.description)} · {String(match.amount)} BDT {canWrite && session.state === "draft" && <button type="button" className="secondary" disabled={busy} onClick={() => void reverse(String(match.id))}>Reverse with reason</button>}</li>; })}</ul>}</section>
  </main>;
}
