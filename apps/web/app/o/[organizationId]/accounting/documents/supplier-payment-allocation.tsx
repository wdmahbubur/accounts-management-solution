import { displayMoney } from "../../../../../components/finance/contracts.ts";
import type { SupplierBillTarget } from "../../../../../server/documents/supplier-payments.ts";
import { suggestedBillAmount, type SettlementPlanLine, type SupplierAllocationDisplay } from "./supplier-payment-selection.ts";
import styles from "./documents.module.css";

export function SupplierPaymentAllocation({ partyId, accountingDate, targets, plan, amount, display, loading, error, onRefresh, onChange }: {
  partyId: string; accountingDate: string; targets: SupplierBillTarget[]; plan: SettlementPlanLine[]; amount: string;
  display: SupplierAllocationDisplay; loading: boolean; error: string; onRefresh: () => void;
  onChange: (plan: SettlementPlanLine[]) => void;
}) {
  const missing = plan.filter(row => !targets.some(target => target.openItemId === row.target_open_item_id));
  return <section className={`${styles.wide} ${styles.editorSection}`} aria-labelledby="supplier-bill-selection" aria-busy={loading}>
    <div className={styles.sectionHeading}><div><h2 id="supplier-bill-selection">Apply payment to bills</h2>
      <p className={styles.hint}>Select the supplier bills this payment covers. Allocate to at least one bill before submitting for approval. Any amount left over stays available on the supplier’s account.</p></div>
      <button type="button" className="secondary" disabled={loading || !partyId || !accountingDate} onClick={onRefresh}>Refresh bill list</button></div>
    <p className={styles.hint}>Available amounts account for this date and later settlements. Draft selections do not reserve a balance; posting checks it again.</p>
    {loading && <p role="status">Loading eligible supplier bills…</p>}
    {error && <p role="alert" className={styles.error}>{error} Your entered bill amounts are preserved.</p>}
    {!partyId ? <p>Choose a supplier to see their open bills.</p> : !loading && !error && targets.length === 0 ?
      <p>No eligible open bills are available for this supplier and date. Save this payment as a draft and return when a bill is available to allocate.</p> : null}
    <div className={styles.selectionCards}>{targets.map(target => {
      const index = plan.findIndex(row => row.target_open_item_id === target.openItemId);
      const selected = index >= 0 ? plan[index] : undefined;
      const label = target.documentNumber ?? target.supplierReference ?? "Supplier bill";
      const field = `allocation_plan.${index + 1}.amount`;
      const issue = display.issues.find(item => item.field === field);
      return <article key={target.openItemId} className={`${styles.selectionCard} ${selected ? styles.selectionActive : ""}`}>
        <label className={styles.check}><input type="checkbox" checked={Boolean(selected)} disabled={loading} onChange={event => onChange(event.target.checked
          ? [...plan, { target_open_item_id: target.openItemId, amount: suggestedBillAmount(amount, plan, target) }]
          : plan.filter(row => row.target_open_item_id !== target.openItemId))} /><strong>{label}</strong></label>
        {target.supplierReference && target.supplierReference !== label && <p className={styles.hint}>Supplier reference: {target.supplierReference}</p>}
        <dl className={styles.selectionFacts}><div><dt>Issued</dt><dd>{target.issueDate}</dd></div><div><dt>Due</dt><dd>{target.dueDate ?? "No due date"}</dd></div>
          <div><dt>Bill total</dt><dd>{displayMoney(target.totalAmount)}</dd></div><div><dt>Available to apply</dt><dd>{displayMoney(target.availableAmount)}</dd></div></dl>
        {selected && <label>Apply to {label} (BDT)<input name={field} inputMode="decimal" required value={selected.amount} disabled={loading}
          aria-invalid={Boolean(issue)} aria-describedby={issue ? `${target.openItemId}-amount-error` : undefined}
          onChange={event => onChange(plan.map(row => row.target_open_item_id === target.openItemId ? { ...row, amount: event.target.value } : row))} />
          {issue && <small id={`${target.openItemId}-amount-error`} className={styles.fieldError}>{issue.message}</small>}</label>}
      </article>;
    })}</div>
    {missing.map(row => {
      const index = plan.indexOf(row);
      return <article className={`${styles.selectionCard} ${loading ? "" : styles.selectionUnavailable}`} key={row.target_open_item_id}>
        <h3>{loading ? "Checking selected bill…" : "Selected bill needs review"}</h3>
        <p>{loading ? "Checking this bill for the selected supplier and date. Its entered amount is preserved." : "This selection is unavailable in the current supplier and date’s list. Its entered amount is preserved. Refresh the list or remove it before saving."}</p>
        <label>Previously selected amount (BDT)<input name={`allocation_plan.${index + 1}.amount`} inputMode="decimal" value={row.amount} disabled={loading}
          onChange={event => onChange(plan.map(item => item.target_open_item_id === row.target_open_item_id ? { ...item, amount: event.target.value } : item))} /></label>
        <button type="button" className="secondary" data-draft-edit="true" disabled={loading} onClick={() => onChange(plan.filter(item => item.target_open_item_id !== row.target_open_item_id))}>Remove this selection</button>
      </article>;
    })}
    <dl className={styles.paymentSummary}><div><dt>Payment amount</dt><dd>{display.payment ? displayMoney(display.payment) : "Enter an amount"}</dd></div>
      <div><dt>Applied to bills</dt><dd>{display.applied ? displayMoney(display.applied) : "Check bill amounts"}</dd></div>
      <div><dt>Unallocated payment</dt><dd>{display.remaining ? displayMoney(display.remaining) : "Not calculated"}</dd></div></dl>
    {display.issues.some(issue => issue.field === "allocation_plan") && <p className={styles.fieldError}>{display.issues.find(issue => issue.field === "allocation_plan")?.message}</p>}
  </section>;
}
