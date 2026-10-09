import { displayMoney } from "../../../../../components/finance/contracts.ts";
import type { CreditNoteOptions } from "../../../../../server/documents/credit-notes.ts";
import styles from "./documents.module.css";

export function CreditSourcePicker({ documentType, sourceId, options, search, loading, error, fieldError, onSearchChange, onSearch, onSelect }: {
  documentType: "customer_credit" | "vendor_credit"; sourceId: string; options: CreditNoteOptions | null;
  search: string; loading: boolean; error: string; fieldError?: string;
  onSearchChange: (value: string) => void; onSearch: () => void; onSelect: (sourceId: string) => void;
}) {
  const label = documentType === "customer_credit" ? "invoice" : "supplier bill";
  const selected = options?.selectedSource?.id === sourceId ? options.selectedSource : null;
  const choices = options?.sources ?? [];
  return <div className={`${styles.wide} ${styles.creditSourcePicker}`}>
    <p className={styles.hint}>Choose the posted {label} being credited, then select its original lines below. This records a credit note; it does not move cash or automatically apply the credit.</p>
    <div className={styles.lookupSearch} data-draft-ignore="true">
      <label>Find an original {label}<input value={search} maxLength={100} placeholder="Document number, reference or party name"
        onChange={event => onSearchChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }} /></label>
      <button type="button" className="secondary" disabled={loading} onClick={onSearch}>{loading ? "Loading…" : "Search / refresh"}</button>
    </div>
    <label>Original posted {label}<select name="original_document_id" required value={sourceId} aria-invalid={Boolean(fieldError)}
      aria-describedby={fieldError ? "credit-source-error" : undefined} onChange={event => onSelect(event.target.value)}>
      <option value="">Choose a posted {label}</option>
      {sourceId && !choices.some(source => source.id === sourceId) && <option value={sourceId}>{selected?.documentNumber ?? "Previously selected original document"} · {selected ? selected.partyName : "refresh required"}</option>}
      {choices.map(source => <option key={source.id} value={source.id} disabled={!source.eligible}>
        {source.documentNumber ?? source.supplierReference ?? `Posted ${label}`} · {source.partyName} · {source.issueDate} · {displayMoney(source.totalAmount)}{source.eligible ? "" : " · not eligible"}
      </option>)}
    </select>{fieldError && <small id="credit-source-error" className={styles.fieldError}>{fieldError}</small>}</label>
    {loading && <p role="status">Checking original documents and remaining credit limits…</p>}
    {error && <p role="alert" className={styles.error}>{error} Your entered credit lines are preserved.</p>}
    {!loading && !error && options && choices.length === 0 && <p>No matching posted {label} is available. Change the party, accounting date or search to find another source.</p>}
    {options?.hasMore && <p className={styles.hint}>More documents match. Narrow the search by document number, reference or party name.</p>}
    {selected && <div className={styles.selectionCard}>
      <strong>{selected.documentNumber ?? selected.supplierReference ?? `Original ${label}`} · {selected.partyName}</strong>
      <dl className={styles.selectionFacts}><div><dt>Original total</dt><dd>{displayMoney(selected.totalAmount)}</dd></div><div><dt>Remaining credit limit</dt><dd>{displayMoney(selected.remainingTotalAmount)}</dd></div><div><dt>Accounting date</dt><dd>{selected.accountingDate}</dd></div></dl>
      {!selected.eligible && <p className={styles.fieldError}>{selected.blockedReason ?? "This original document is no longer eligible for credit."}</p>}
      <p className={styles.hint}>Each line keeps its original tax basis. If part was already credited, adjust the proposed quantity, price or discount within the remaining limits. Posting checks those limits again.</p>
    </div>}
  </div>;
}
