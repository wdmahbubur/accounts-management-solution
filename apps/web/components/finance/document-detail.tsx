import type { ReactNode } from "react";
import Link from "next/link";
import { displayMoney } from "./contracts.ts";
import {
  accountLabel, detailDate, detailDecimal, detailRecord, detailRows, detailText, detailTimestamp,
  documentHeading, exactJournalTotals, humanLabel, issuedPartyDetails, sourceName, sourceStateExplanation,
  sourceStateLabel, type DetailRecord
} from "./document-detail-model.ts";
import styles from "./document-detail.module.css";

export function DocumentHeader({ document, invoiceLifecycle, receiptLifecycle, supplierLifecycle, actions, amountLabel }: {
  document: DetailRecord; invoiceLifecycle: DetailRecord | null; receiptLifecycle: DetailRecord | null; supplierLifecycle?: DetailRecord | null; actions?: ReactNode; amountLabel?: string;
}) {
  const deliveries = detailRows(invoiceLifecycle?.delivery_attempts);
  return <header className={styles.header}>
    <div className={styles.headingRow}>
      <div><p className={styles.eyebrow}>{document.document_number ? sourceName(document.document_type) : "Financial document"}</p>
        <div className={styles.titleRow}><h1>{documentHeading(document)}</h1><span className={styles.badge} data-state={String(document.state)}>{sourceStateLabel(document)}</span>
          {document.reversed_by_document_id ? <span className={styles.badge} data-state="void">Reversed</span> : null}</div>
        <p className={styles.hint}>{sourceStateExplanation(document)}</p>
      </div>
      <div className={styles.headAmount}><span>{amountLabel ?? (document.document_type === "transfer" ? "Total sent, including fee" : "Document total")} · BDT</span><strong>{displayMoney(document.total_amount)}</strong></div>
    </div>
    {invoiceLifecycle ? <dl className={styles.statusStrip}>
      <div><dt>Settlement</dt><dd>{humanLabel(invoiceLifecycle.settlement_status)}{invoiceLifecycle.overdue === true ? <span className={styles.overdue}>Overdue</span> : null}</dd></div>
      <div><dt>Outstanding · BDT</dt><dd>{invoiceLifecycle.residual_amount === null ? "Available after posting" : displayMoney(invoiceLifecycle.residual_amount)}</dd></div>
      <div><dt>Delivery</dt><dd>{deliveries.length ? humanLabel(deliveries.at(-1)?.status) : "Not sent"}</dd></div>
    </dl> : null}
    {receiptLifecycle && document.state === "posted" ? <dl className={styles.statusStrip}>
      <div><dt>Applied to invoices · BDT</dt><dd>{displayMoney(receiptLifecycle.applied_amount)}</dd></div>
      <div><dt>Unused customer credit · BDT</dt><dd>{receiptLifecycle.residual_amount === null ? "Unavailable" : displayMoney(receiptLifecycle.residual_amount)}</dd></div>
    </dl> : null}
    {supplierLifecycle && document.document_type === "bill" ? <dl className={styles.statusStrip}>
      <div><dt>Settlement</dt><dd>{humanLabel(supplierLifecycle.settlement_status)}{supplierLifecycle.overdue === true ? <span className={styles.overdue}>Overdue</span> : null}</dd></div>
      <div><dt>Outstanding · BDT</dt><dd>{supplierLifecycle.residual_amount === null ? "Available on the accounting date after posting" : displayMoney(supplierLifecycle.residual_amount)}</dd></div>
      <div><dt>Balance as of</dt><dd>{detailDate(supplierLifecycle.as_of_date)}</dd></div>
    </dl> : null}
    {supplierLifecycle && supplierLifecycle.settlement_status !== "reversed" && document.document_type === "vendor_payment" && document.state === "posted" ? <dl className={styles.statusStrip}>
      <div><dt>Applied to bills · BDT</dt><dd>{supplierLifecycle.residual_amount === null ? "Available on the accounting date" : displayMoney(supplierLifecycle.applied_amount)}</dd></div>
      <div><dt>Unused supplier trade debit · BDT</dt><dd>{supplierLifecycle.residual_amount === null ? "Available on the accounting date" : displayMoney(supplierLifecycle.residual_amount)}</dd></div>
      <div><dt>Balance as of</dt><dd>{detailDate(supplierLifecycle.as_of_date)}</dd></div>
    </dl> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>;
}

export function DocumentFacts({ document }: { document: DetailRecord }) {
  const party = issuedPartyDetails(document), trade = detailRecord(document.trade);
  const hasParty = typeof document.party_id === "string" || Object.keys(detailRecord(document.party_snapshot)).length > 0;
  const supplier = ["bill", "vendor_credit", "vendor_payment", "vendor_refund", "vendor_advance", "paid_expense"].includes(String(document.document_type));
  const partyTitle = `${document.state === "posted" ? "Issued" : "Saved"} ${supplier ? "supplier" : "customer"}`;
  return <section id="document-details" className={styles.section} aria-labelledby="document-details-title">
    <h2 id="document-details-title">Document details</h2>
    <div className={hasParty ? styles.detailsGrid : undefined}>
      {hasParty ? <section aria-label={partyTitle} className={styles.party}>
        <h3>{partyTitle}</h3><p className={styles.partyName}>{party.displayName}</p>
        {party.legalName && party.legalName !== party.displayName ? <p>{party.legalName}</p> : null}
        {party.email ? <p>{party.email}</p> : null}{party.phone ? <p>{party.phone}</p> : null}
        <div className={styles.address}><h4>Billing address</h4>{party.addressLines.length
          ? <address>{party.addressLines.map((line, index) => <span key={index}>{line}</span>)}</address>
          : <p className={styles.hint}>No billing address was recorded on this document.</p>}</div>
        {party.taxIdentifiers.length ? <dl className={styles.taxIds}>{party.taxIdentifiers.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
        <p className={styles.hint}>{document.state === "posted" ? "These are the original issued details. Later contact edits do not change this document." : "These details belong to the saved document version."}</p>
      </section> : null}
      <dl className={styles.facts}>
        <div><dt>Issue date</dt><dd>{detailDate(document.issue_date)}</dd></div>
        <div><dt>Accounting date</dt><dd>{detailDate(document.accounting_date)}</dd></div>
        {document.due_date ? <div><dt>Due date</dt><dd>{detailDate(document.due_date)}</dd></div> : null}
        {document.external_reference ? <div><dt>Reference</dt><dd>{detailText(document.external_reference)}</dd></div> : null}
        {trade.supplier_invoice_key ? <div><dt>Supplier invoice reference</dt><dd>{detailText(trade.supplier_invoice_key)}</dd></div> : null}
        {trade.supplier_invoice_date ? <div><dt>Supplier invoice date</dt><dd>{detailDate(trade.supplier_invoice_date)}</dd></div> : null}
        {trade.recognition_mode ? <div><dt>Recognition</dt><dd>{humanLabel(trade.recognition_mode)}</dd></div> : null}
        {Object.hasOwn(trade, "performance_confirmed") ? <div><dt>Performance confirmed</dt><dd>{trade.performance_confirmed === true ? "Yes" : "No"}</dd></div> : null}
      </dl>
    </div>
    {document.description || trade.terms || trade.notes ? <div className={styles.notes}>
      {document.description ? <div><h3>Description</h3><p>{detailText(document.description)}</p></div> : null}
      {trade.terms ? <div><h3>Terms</h3><p>{detailText(trade.terms)}</p></div> : null}
      {trade.notes ? <div><h3>Notes</h3><p>{detailText(trade.notes)}</p></div> : null}
    </div> : null}
  </section>;
}

export function DocumentItems({ document }: { document: DetailRecord }) {
  const rows = detailRows(document.lines);
  if (!rows.length) return null;
  return <section className={styles.section} aria-labelledby="document-items-title">
    <h2 id="document-items-title">Items and services</h2>
    <div className={styles.tableScroll}><table className={styles.itemsTable}>
      <caption>Saved line amounts · BDT</caption><thead><tr><th scope="col">Item / description</th><th scope="col">Quantity</th><th scope="col">Unit rate</th><th scope="col">Discount</th><th scope="col">Net</th><th scope="col">Tax</th><th scope="col">Total</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const item = detailRecord(row.item_snapshot), center = detailRecord(row.cost_center_snapshot);
        return <tr key={detailText(row.id, String(index))}>
          <th scope="row"><span>{detailText(row.description)}</span>
            {item.name && item.name !== row.description ? <small>{detailText(item.name)}</small> : null}
            {item.sku ? <small>SKU: {detailText(item.sku)}</small> : null}
            {center.name ? <small>Cost center: {[detailText(center.code, ""), detailText(center.name, "")].filter(Boolean).join(" · ")}</small> : null}
          </th>
          <td className={styles.amount}>{detailDecimal(row.quantity)}{item.unit ? <small>{detailText(item.unit)}</small> : null}</td>
          <td className={styles.amount}>{detailDecimal(row.unit_price, true)}</td><td className={styles.amount}>{displayMoney(row.discount_amount)}</td>
          <td className={styles.amount}>{displayMoney(row.net_amount)}</td><td className={styles.amount}>{displayMoney(row.tax_amount)}
            <small>{detailText(row.tax_label_snapshot, "No tax")}{row.tax_rate_snapshot ? ` · ${detailDecimal(row.tax_rate_snapshot)}%` : ""}</small>
            {row.tax_code_id ? <small>{row.tax_mode === "inclusive" ? "Included in rate" : "Added to net"}{row.tax_recoverability_snapshot ? ` · ${humanLabel(row.tax_recoverability_snapshot)} recovery` : ""}</small> : null}
          </td><td className={styles.amount}><strong>{displayMoney(row.gross_amount)}</strong></td>
        </tr>;
      })}</tbody>
    </table></div>
    <dl className={styles.totals}><div><dt>Net</dt><dd>{displayMoney(document.net_amount)}</dd></div><div><dt>Tax</dt><dd>{displayMoney(document.tax_amount)}</dd></div>
      {document.rounding_adjustment !== "0.00" ? <div><dt>Rounding adjustment</dt><dd>{displayMoney(document.rounding_adjustment)}</dd></div> : null}
      <div className={styles.total}><dt>Total · BDT</dt><dd>{displayMoney(document.total_amount)}</dd></div></dl>
    {document.rounding_adjustment !== "0.00" ? <p className={styles.hint}>Rounding: {detailText(document.rounding_reason)} · {accountLabel(document, "rounding_account")}</p> : null}
  </section>;
}

export function CashMovementDetails({ document }: { document: DetailRecord }) {
  const movement = detailRecord(document.movement), transfer = detailRecord(document.transfer), writeOff = detailRecord(document.write_off);
  if (Object.keys(transfer).length) return <section className={styles.section} aria-labelledby="transfer-details-title">
    <h2 id="transfer-details-title">Transfer details</h2>
    <div className={styles.transfer}><div><span>From</span><strong>{detailText(transfer.from_cash_account_name, "Source account name unavailable")}</strong></div><span className={styles.transferTo}>to</span><div><span>To</span><strong>{detailText(transfer.to_cash_account_name, "Destination account name unavailable")}</strong></div></div>
    <dl className={styles.facts}><div><dt>Transfer principal · BDT</dt><dd>{displayMoney(transfer.amount)}</dd></div><div><dt>Transfer fee · BDT</dt><dd>{displayMoney(transfer.fee_amount)}</dd></div>
      {transfer.fee_account_id ? <div><dt>Fee account</dt><dd>{accountLabel(transfer, "fee_account")}</dd></div> : null}</dl>
  </section>;
  if (Object.keys(movement).length) return <section className={styles.section} aria-labelledby="movement-details-title">
    <h2 id="movement-details-title">{movement.direction === "in" ? "Money received" : "Money paid"}</h2>
    <dl className={styles.facts}><div><dt>{movement.direction === "in" ? "Received into" : "Paid from"}</dt><dd>{detailText(movement.cash_account_name, "Cash account name unavailable")}</dd></div>
      <div><dt>Amount · BDT</dt><dd>{displayMoney(movement.amount)}</dd></div><div><dt>Method</dt><dd>{humanLabel(movement.method, "Not recorded")}</dd></div>
      <div><dt>Payment reference</dt><dd>{detailText(movement.reference, "Not recorded")}</dd></div><div><dt>Cash-flow classification</dt><dd>{humanLabel(movement.cash_flow_class, "Not recorded")}</dd></div></dl>
  </section>;
  if (Object.keys(writeOff).length) return <section className={styles.section} aria-labelledby="write-off-details-title"><h2 id="write-off-details-title">Write-off details</h2>
    <dl className={styles.facts}><div><dt>Expense account</dt><dd>{accountLabel(writeOff, "expense_account")}</dd></div><div><dt>Amount · BDT</dt><dd>{displayMoney(writeOff.amount)}</dd></div><div><dt>Reason</dt><dd>{detailText(writeOff.reason)}</dd></div></dl></section>;
  return null;
}

export function JournalTable({ rows, caption }: { rows: DetailRecord[]; caption: string }) {
  const totals = exactJournalTotals(rows);
  if (!rows.length) return <p className={styles.hint}>No journal lines are available.</p>;
  return <><div className={styles.tableScroll}><table className={styles.journalTable}><caption>{caption} · All {rows.length} lines · BDT</caption>
    <thead><tr><th scope="col">Account</th><th scope="col">Line details</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={detailText(row.line_id, String(row.line_no ?? index))}>
      <th scope="row"><span>{accountLabel(row)}</span>{row.party_id ? <small>Party: {detailText(row.party_name, "Name not recorded")}</small> : null}</th>
      <td>{detailText(row.description, "No description")}
        {row.cost_center_id ? <small>Cost center: {[detailText(row.cost_center_code, ""), detailText(row.cost_center_name, "")].filter(Boolean).join(" · ") || "Name unavailable"}</small> : null}
        {row.cash_flow_class ? <small>Cash flow: {humanLabel(row.cash_flow_class)}</small> : null}
        {row.open_item_reference ? <small>Original reference: {detailText(row.open_item_reference)}</small> : null}
        {row.open_item_due_date ? <small>Due: {detailDate(row.open_item_due_date)}</small> : null}
      </td><td className={styles.amount}>{displayMoney(row.debit)}</td><td className={styles.amount}>{displayMoney(row.credit)}</td>
    </tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>Total</th><td className={styles.amount}>{displayMoney(totals.debit)}</td><td className={styles.amount}>{displayMoney(totals.credit)}</td></tr></tfoot>
  </table></div><p className={totals.balanced ? styles.hint : styles.overdue}>{totals.balanced ? "Debits and credits balance." : "These displayed lines do not balance. Review the complete source before proceeding."}</p></>;
}

export function PlannedSettlements({ organizationId, document }: { organizationId: string; document: DetailRecord }) {
  const rows = detailRows(document.allocation_plan);
  if (!rows.length) return null;
  return <section className={styles.section} aria-labelledby="planned-settlements-title"><h2 id="planned-settlements-title">Saved allocation plan</h2>
    <p className={styles.hint}>{document.state === "posted" ? "The plan recorded with this source. Later settlement changes are separate dated events." : "These amounts are planned only. Settlement takes effect when the document is posted."}</p>
    <div className={styles.tableScroll}><table><caption>Planned invoice or bill allocations · BDT</caption><thead><tr><th scope="col">Target document</th><th scope="col">Amount</th></tr></thead><tbody>{rows.map((row, index) => <tr key={detailText(row.target_open_item_id, String(index))}>
      <td>{row.target_document_id ? <Link href={`/o/${organizationId}/accounting/documents/${String(row.target_document_id)}`}>{detailText(row.target_document_number, "Unnumbered source")}</Link> : "Target document is outside this view"}</td><td className={styles.amount}>{displayMoney(row.amount)}</td>
    </tr>)}</tbody></table></div></section>;
}

export function Disclosure({ title, count, children, id }: { title: string; count?: number; children: ReactNode; id?: string }) {
  return <details id={id} className={styles.disclosure}><summary>{title}{count !== undefined ? <span className={styles.count}>{count}</span> : null}</summary><div className={styles.disclosureBody}>{children}</div></details>;
}

export function DocumentHistory({ organizationId, lifecycle, capabilities }: { organizationId: string; lifecycle: DetailRecord | null; capabilities: readonly string[] }) {
  if (!lifecycle) return null;
  const deliveries = detailRows(lifecycle.delivery_attempts), approvals = detailRows(lifecycle.approvals), corrections = detailRows(lifecycle.corrections), attachments = detailRows(lifecycle.attachments), activity = detailRows(lifecycle.activity);
  return <div className={styles.history}>
    {Object.hasOwn(lifecycle, "delivery_attempts") ? <Disclosure title="Delivery history" count={deliveries.length}>{deliveries.length ? <ol className={styles.timeline}>{deliveries.map((item, index) => <li key={index}><strong>{humanLabel(item.status)} · {humanLabel(item.channel)}</strong><span>{detailTimestamp(item.created_at)}</span>{item.delivered_at ? <span>Delivered {detailTimestamp(item.delivered_at)}</span> : null}</li>)}</ol> : <p className={styles.hint}>No delivery attempt is recorded. Delivery status is separate from posting.</p>}</Disclosure> : null}
    {capabilities.includes("approvals.read") && Object.hasOwn(lifecycle, "approvals") ? <Disclosure title="Approval history" count={approvals.length}>{approvals.length ? approvals.map((request, index) => <article key={detailText(request.id, String(index))} className={styles.historyEntry}><h3>{humanLabel(request.state)} · Version {String(request.version)}</h3><p className={styles.hint}>{detailTimestamp(request.created_at)}</p>
      {detailRows(request.decisions).map((decision, decisionIndex) => <p key={decisionIndex}>{humanLabel(decision.decision)} by {detailText(decision.decided_by)} · {detailTimestamp(decision.created_at)}{decision.reason ? ` · ${detailText(decision.reason)}` : ""}</p>)}</article>) : <p className={styles.hint}>No approval request is recorded.</p>}</Disclosure> : null}
    {corrections.length ? <Disclosure title="Linked corrections" count={corrections.length}>{corrections.map((row, index) => <div key={detailText(row.id, String(index))} className={styles.historyEntry}><Link href={`/o/${organizationId}/accounting/documents/${String(row.id)}`}>{detailText(row.document_number, sourceName(row.document_type))}</Link><p>{humanLabel(row.state)} · {detailDate(row.accounting_date)}{row.reason ? ` · ${detailText(row.reason)}` : ""}</p></div>)}</Disclosure> : null}
    {capabilities.includes("attachments.read") && Object.hasOwn(lifecycle, "attachments") ? <Disclosure title="Attachments" count={attachments.length}>{attachments.length ? <ul className={styles.timeline}>{attachments.map((item, index) => <li key={detailText(item.id, String(index))}><strong>{detailText(item.filename)}</strong><span>{detailText(item.content_type)} · {String(item.byte_size)} bytes · {humanLabel(item.scan_status)}</span></li>)}</ul> : <p className={styles.hint}>No attachment is linked to this document.</p>}</Disclosure> : null}
    {capabilities.includes("audit.read") && Object.hasOwn(lifecycle, "activity") ? <Disclosure title="Activity log" count={activity.length}>{activity.length ? <ol className={styles.timeline}>{activity.map((event, index) => <li key={index}><strong>{humanLabel(event.action)}</strong><span>{humanLabel(event.actor_kind)} · {detailTimestamp(event.created_at)}</span>{event.reason ? <span>{detailText(event.reason)}</span> : null}</li>)}</ol> : <p className={styles.hint}>No activity is recorded.</p>}</Disclosure> : null}
  </div>;
}

export function DocumentTechnicalDetails({ document, showJournal }: { document: DetailRecord; showJournal: boolean }) {
  const journal = showJournal ? detailRecord(document.posted_journal) : {};
  return <Disclosure title="Document reference information"><dl className={styles.facts}>
    <div><dt>Document ID</dt><dd className={styles.identifier}>{detailText(document.id)}</dd></div><div><dt>Saved version</dt><dd>{String(document.version)}</dd></div>
    {document.material_digest ? <div><dt>Content digest</dt><dd className={styles.identifier}>{detailText(document.material_digest)}</dd></div> : null}
    {journal.id ? <div><dt>Posted journal ID</dt><dd className={styles.identifier}>{detailText(journal.id)}</dd></div> : null}
  </dl></Disclosure>;
}
