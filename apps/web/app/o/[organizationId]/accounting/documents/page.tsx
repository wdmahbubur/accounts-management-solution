import {CompanyCurrency} from '../../../../../components/finance/company-currency.tsx';
import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readDocumentDirectory, type DirectoryRow } from "../../../../../server/documents/directory.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import styles from "./documents.module.css";

type DraftGroup = { title: string; entries: readonly (readonly [string, string])[]; includeWriteOff?: boolean };
const commonDraftGroups: readonly DraftGroup[] = [
  { title: "Sales", entries: [["invoice", "Invoice"], ["receipt", "Receipt"]] },
  { title: "Purchases", entries: [["bill", "Supplier bill"], ["vendor_payment", "Supplier payment"], ["paid_expense", "Paid expense"]] },
  { title: "Accounting", entries: [["transfer", "Transfer"], ["manual_journal", "Manual journal"]] }
];
const otherDraftGroups: readonly DraftGroup[] = [
  { title: "Customer credits and advances", entries: [["customer_credit", "Customer credit"], ["customer_advance", "Customer advance"]] },
  { title: "Supplier credits and advances", entries: [["vendor_credit", "Supplier credit"], ["vendor_advance", "Supplier advance"]] },
  { title: "Adjustments and opening balances", entries: [["controlled_adjustment", "Controlled adjustment"], ["opening_balance", "Opening balance"]], includeWriteOff: true }
];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DocumentDirectoryPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId: ReturnType<typeof parseOrganizationId>;
  try {
    organizationId = parseOrganizationId((await params).organizationId);
  } catch {
    redirect("/companies?error=not_found");
  }

  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let rows: DirectoryRow[] | undefined;
  let canAdjust = false;
  let canWriteJournal = false;
  let canPrepareOpening = false;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("documents.read")) throw CommandError.forbidden();
    canAdjust = actor.capabilities.includes("dues.adjust");
    canWriteJournal = actor.capabilities.includes("journal.write");
    canPrepareOpening = canWriteJournal && actor.capabilities.includes("accounting.read");
    rows = await readDocumentDirectory(runtime.client, organizationId);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof CommandError && failure.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (failure instanceof CommandError && failure.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (failure instanceof CommandError && failure.code === "FORBIDDEN") {
      return <main><h1>Access denied</h1><p>You need documents.read to view financial documents.</p></main>;
    }
    throw failure;
  }

  function draftGroups(groups: readonly DraftGroup[]) {
    return groups.map((group) => <div className={styles.draftGroup} key={group.title}>
      <h3>{group.title}</h3>
      <ul className={styles.draftLinks}>
        {group.entries.filter(([type]) => type !== "opening_balance" || canPrepareOpening).map(([type, label]) => (
          <li key={type}><Link href={type === "opening_balance" ? `/o/${organizationId}/settings/opening-balances` : `/o/${organizationId}/accounting/documents/new?type=${type}`}>{label}</Link></li>
        ))}
        {group.includeWriteOff && canAdjust && <li><Link href={`/o/${organizationId}/accounting/write-offs/new`}>Bad-debt write-off</Link></li>}
      </ul>
    </div>);
  }

  return (
    <main className={styles.main}>
      <p className="eyebrow">Finance workspace</p>
      <h1>Financial documents</h1>
      <p className={styles.hint}>Drafts are saved without ledger effect. Posting, settlement and delivery stay separate actions.</p>
      <section className={`panel ${styles.panel}`}>
        <h2>Create a draft</h2>
        <div className={styles.draftGroups}>{draftGroups(commonDraftGroups)}</div>
        <details className={styles.draftMore}>
          <summary>Credits, advances and adjustments</summary>
          <div className={styles.draftGroups}>{draftGroups(otherDraftGroups)}</div>
          <Link href={`/o/${organizationId}/advances`}>Manage advances and linked refunds</Link>
        </details>
      </section>
      <section className={`panel ${styles.panel}`}>
        <h2>Recent sources</h2>
        {rows?.length ? (
          <div className={styles.grid}>
            <table>
              <thead><tr><th>Number</th><th>Type</th><th>Accounting date</th><th>State</th><th>Total (<CompanyCurrency />)</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td><Link href={`/o/${organizationId}/accounting/documents/${row.id}`}>{row.documentNumber ?? "Draft"}</Link></td>
                  <td>{row.documentType.replaceAll("_", " ")}</td><td>{row.accountingDate}</td><td>{row.state.replaceAll("_", " ")}</td><td>{row.totalAmount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>No documents yet.</p>}
      </section>
    </main>
  );
}
