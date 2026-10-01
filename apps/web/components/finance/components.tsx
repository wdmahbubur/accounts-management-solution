"use client";
import { createContext, useContext, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { displayMoney, feedback, moneyInputError, type FeedbackKind, type ScopedOptions } from "./contracts.ts";
import styles from "./finance.module.css";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback); window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
export function useOnline() { return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true); }
const ReadOnlyContext = createContext(false);
export function FinanceInteractionBoundary({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}
export function ViewState({ kind, requestId, children }: { kind: FeedbackKind; requestId?: string; children?: ReactNode }) {
  return <section className={styles.feedback} role={["error", "conflict", "forbidden"].includes(kind) ? "alert" : "status"} aria-busy={kind === "loading" || undefined}>
    <strong>{feedback[kind].title}</strong><p>{feedback[kind].description}</p>
    {requestId && <p>Request reference: <code>{requestId}</code></p>}{children}
  </section>;
}
export function MoneyCell({ value }: { value?: string | null }) {
  if (value === undefined || value === null) return <span className={styles.money}>Not available</span>;
  let formatted: string;
  try { formatted = displayMoney(value); } catch { formatted = "Invalid amount"; }
  return <span className={styles.money}>{formatted}</span>;
}
export function MoneyInput({ label, name, value, onChange, error, allowNegative = false, disabled = false }: {
  label: string; name: string; value: string; onChange: (value: string) => void; error?: string; allowNegative?: boolean; disabled?: boolean;
}) {
  const id = useId(); const [touched, setTouched] = useState(false);
  const message = error ?? (touched ? moneyInputError(value, allowNegative) : undefined);
  const online = useOnline(); const readOnly = useContext(ReadOnlyContext);
  return <div className="field"><label htmlFor={id}>{label}</label>
    <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)}
      type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={22} disabled={disabled || !online || readOnly}
      aria-invalid={Boolean(message)} aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`} />
    <small id={`${id}-hint`}>BDT · use two decimal places, for example 1250.00</small>
    {message && <p id={`${id}-error`} role="alert">{message}</p>}
  </div>;
}
function ScopedPicker({ label, name, organizationId, data, value, onChange, disabled }: {
  label: string; name: string; organizationId: string; data: ScopedOptions; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const id = useId(); const online = useOnline(); const readOnly = useContext(ReadOnlyContext);
  if (data.organizationId !== organizationId) return <ViewState kind="conflict" />;
  return <div className="field"><label htmlFor={id}>{label}</label>
    <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || !online || readOnly || data.options.length === 0}>
      <option value="">{data.options.length ? "Choose an authorized record" : "No eligible records"}</option>
      {data.options.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
    </select>
  </div>;
}
export const AccountPicker = ScopedPicker;
export const PartyPicker = ScopedPicker;
export interface DraftLine { id: string; description: string; quantity: string; unitPrice: string }
export function DocumentLineGrid({ lines, onChange, onRemove, disabled }: {
  lines: readonly DraftLine[]; onChange: (id: string, field: "description" | "quantity" | "unitPrice", value: string) => void;
  onRemove: (id: string) => void; disabled?: boolean;
}) {
  const online = useOnline(); const readOnly = useContext(ReadOnlyContext);
  return <div className={styles.table} tabIndex={0} role="region" aria-label="Document lines table">
    <table><caption>Draft lines · totals are calculated by the server</caption><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Action</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={line.id}>
        {(["description", "quantity", "unitPrice"] as const).map((field) => <td key={field}><input
          aria-label={`${field === "unitPrice" ? "Unit price" : field === "quantity" ? "Quantity" : "Description"} line ${index + 1}`}
          value={line[field]} inputMode={field === "description" ? "text" : "decimal"} disabled={disabled || !online || readOnly}
          maxLength={field === "description" ? 500 : 21} onChange={(e) => onChange(line.id, field, e.target.value)} /></td>)}
        <td><button type="button" className="secondary" disabled={disabled || !online || readOnly} onClick={() => onRemove(line.id)} aria-label={`Remove line ${index + 1}`}>Remove</button></td>
      </tr>)}</tbody></table>{lines.length === 0 && <ViewState kind="empty" />}
  </div>;
}
export function PostingPreview({ state, data }: { state: "loading" | "error" | "forbidden" | "ready";
  data?: { sourceVersion: number; rows: { id: string; accountLabel: string; debit: string; credit: string }[]; totalDebit: string; totalCredit: string } }) {
  if (state !== "ready") return <ViewState kind={state} />;
  if (!data) return <ViewState kind="error" />;
  return <section aria-label="Posting preview"><h2>Posting preview</h2><p>Not posted · reviewed source version {data.sourceVersion}</p>
    <div className={styles.table} tabIndex={0} role="region" aria-label="Posting preview table"><table><caption>Server-provided journal preview</caption>
      <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
      <tbody>{data.rows.map((row) => <tr key={row.id}><th scope="row">{row.accountLabel}</th><td><MoneyCell value={row.debit} /></td><td><MoneyCell value={row.credit} /></td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Server totals</th><td><MoneyCell value={data.totalDebit} /></td><td><MoneyCell value={data.totalCredit} /></td></tr></tfoot>
    </table></div></section>;
}
export function StatusBadge({ status }: { status: "draft" | "posted" | "pending" | "reversed" | "inactive" }) {
  return <span className={styles.badge}>{status}</span>;
}
export function AuditDrawer({ allowed, entries }: { allowed: boolean; entries: readonly { id: string; action: string; actor: string; time: string }[] }) {
  const ref = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const id = useId();
  if (!allowed) return <ViewState kind="forbidden" />;
  return <><button ref={trigger} type="button" className="secondary" onClick={() => ref.current?.showModal()}>View audit history</button>
    <dialog ref={ref} className={styles.dialog} aria-labelledby={id} onClose={() => trigger.current?.focus()}>
      <h2 id={id}>Audit history</h2>{entries.length ? <ol>{entries.map((item) => <li key={item.id}><strong>{item.action}</strong><span>{item.actor}</span><time>{item.time}</time></li>)}</ol> : <ViewState kind="empty" />}
      <button type="button" onClick={() => ref.current?.close()}>Close audit history</button>
    </dialog></>;
}
/** Keep a stable requestKey until the caller reconciles the result. Remount only
 * after a verified new operation; never mint a new key following an uncertain response.
 */
export function ConfirmAction({ label, title, description, requestKey, onConfirm, disabled }: {
  label: string; title: string; description: string; requestKey: string;
  onConfirm: (requestKey: string) => Promise<void>; disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const id = useId();
  const inFlight = useRef(false); const readOnly = useContext(ReadOnlyContext);
  const online = useOnline(); const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "confirmed" | "uncertain">("idle");
  const unavailable = disabled || !online || readOnly || pending || outcome !== "idle";
  return <><button ref={trigger} type="button" disabled={unavailable} onClick={() => ref.current?.showModal()}>{label}</button>
    {outcome === "confirmed" && <p role="status">Action confirmed. Refresh the record before another change.</p>}
    {outcome === "uncertain" && <p role="status">Verify the record before another attempt. No new request key has been created.</p>}
    <dialog ref={ref} className={styles.dialog} aria-labelledby={id} aria-describedby={`${id}-description`}
      onCancel={(event) => { if (pending) event.preventDefault(); }} onClose={() => trigger.current?.focus()}>
      <h2 id={id}>{title}</h2><p id={`${id}-description`}>{description}</p>
      {outcome === "uncertain" && <p role="alert">Outcome could not be confirmed. Check the record before retrying with the same request key.</p>}
      <div className="actions"><button type="button" className="secondary" disabled={pending} onClick={() => ref.current?.close()}>Cancel</button>
        <button type="button" disabled={unavailable} onClick={async () => {
          if (inFlight.current || unavailable) return;
          inFlight.current = true; setPending(true);
          try { await onConfirm(requestKey); setOutcome("confirmed"); ref.current?.close(); }
          catch { setOutcome("uncertain"); }
          finally { setPending(false); }
        }}>{pending ? "Confirming…" : "Confirm"}</button></div>
    </dialog></>;
}
export function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (range: { start: string; end: string }) => void }) {
  const id = useId(); const invalid = Boolean(start && end && start > end);
  return <fieldset className={styles.dateRange}><legend>Date range</legend>
    <div className="field"><label htmlFor={`${id}-from`}>From date</label><input type="date" id={`${id}-from`} value={start} onChange={(e) => onChange({ start: e.target.value, end })} /></div>
    <div className="field"><label htmlFor={`${id}-to`}>To date</label><input type="date" id={`${id}-to`} value={end} onChange={(e) => onChange({ start, end: e.target.value })} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} /></div>
    {invalid && <p id={`${id}-error`} role="alert">End date must not precede start date.</p>}
  </fieldset>;
}
