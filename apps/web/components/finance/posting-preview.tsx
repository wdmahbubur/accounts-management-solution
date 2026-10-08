import type { PostingPreviewResult } from "../../lib/posting-preview.ts";
import { displayMoney } from "./contracts.ts";
import styles from "./posting-preview.module.css";

export function PostingPreview({ result }: { result: PostingPreviewResult }) {
  const { preview } = result;
  return <section className={styles.preview} aria-label="Posting preview">
    <header className={styles.heading}>
      <div><h2>Posting preview</h2><p>Saved version {result.documentVersion} · BDT</p></div>
      {preview.kind !== "trade" && <p className={preview.balanced ? styles.balanced : styles.warning} role="status">
        {preview.balanced ? "Debits and credits balance" : "Journal needs attention"}
      </p>}
    </header>
    {preview.kind === "trade" ? <>
      <div className="table-scroll"><table>
        <caption>Document calculation</caption>
        <thead><tr><th scope="col">Description</th><th scope="col" className={styles.amount}>Net</th><th scope="col" className={styles.amount}>Tax</th><th scope="col" className={styles.amount}>Gross</th></tr></thead>
        <tbody>{preview.lines.map((line, index) => <tr key={index}>
          <th scope="row">{preview.descriptions[index] || `Line ${index + 1}`}</th>
          <td className={styles.amount}>{displayMoney(line.net)}</td><td className={styles.amount}>{displayMoney(line.tax)}</td><td className={styles.amount}>{displayMoney(line.gross)}</td>
        </tr>)}</tbody>
      </table></div>
      <dl className={styles.totals}><div><dt>Net</dt><dd>{displayMoney(preview.net)}</dd></div><div><dt>Tax</dt><dd>{displayMoney(preview.tax)}</dd></div>
        {preview.rounding_adjustment !== "0.00" && <div><dt>Rounding</dt><dd>{displayMoney(preview.rounding_adjustment)}</dd></div>}
        <div><dt>Document total</dt><dd>{displayMoney(preview.total)}</dd></div></dl>
    </> : <div className="table-scroll"><table>
      <caption>{preview.kind === "cash" ? "Planned journal entries" : "Saved journal rows"}</caption>
      <thead><tr><th scope="col">Account</th><th scope="col">Description / party</th><th scope="col" className={styles.amount}>Debit</th><th scope="col" className={styles.amount}>Credit</th></tr></thead>
      <tbody>{preview.lines.map(line => <tr key={line.lineNo}>
        <th scope="row">{line.accountName ?? "Selected account"}<small className={styles.detail}>{line.accountCode ?? line.accountId}</small></th>
        <td>{line.description || "—"}{line.partyName && <small className={styles.detail}>{line.partyName}</small>}</td>
        <td className={styles.amount}>{displayMoney(line.debit)}</td><td className={styles.amount}>{displayMoney(line.credit)}</td>
      </tr>)}{preview.lines.length === 0 && <tr><td colSpan={4}>Add journal rows before posting.</td></tr>}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>Total</th><td className={styles.amount}>{displayMoney(preview.debit)}</td><td className={styles.amount}>{displayMoney(preview.credit)}</td></tr></tfoot>
    </table></div>}
    {preview.kind === "cash" && preview.unallocatedAmount !== null && <section className={styles.allocations} aria-label="Planned settlements">
      <h3>Planned settlements</h3>
      {preview.allocations.length > 0 ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">Invoice / open item</th><th scope="col" className={styles.amount}>Available at accounting date</th><th scope="col" className={styles.amount}>Planned amount</th></tr></thead>
        <tbody>{preview.allocations.map(allocation => <tr key={allocation.targetOpenItemId}>
          <th scope="row">{allocation.documentNumber ?? `Open item ${allocation.targetOpenItemId.slice(0, 8)}`}</th>
          <td className={styles.amount}>{displayMoney(allocation.availableAmount)}</td><td className={styles.amount}>{displayMoney(allocation.amount)}</td>
        </tr>)}</tbody>
      </table></div> : <p>No invoices or open items are selected for settlement.</p>}
      <dl className={styles.totals}><div><dt>Planned allocation</dt><dd>{displayMoney(preview.allocatedAmount)}</dd></div>
        <div><dt>{preview.sourceType === "receipt" ? "Unallocated receipt" : "Unallocated payment"}</dt><dd>{displayMoney(preview.unallocatedAmount)}</dd></div></dl>
      <p className={styles.note}>Allocations settle the control-account entry above; they do not add another journal entry.</p>
    </section>}
    <div className={styles.note}>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>
  </section>;
}
