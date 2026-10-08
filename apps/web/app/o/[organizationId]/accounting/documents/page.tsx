import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readDocumentDirectory, type DirectoryRow } from "../../../../../server/documents/directory.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import styles from "./documents.module.css";

const draftTypes = [
  ["invoice", "Invoice"], ["customer_credit", "Customer credit"], ["bill", "Supplier bill"],
  ["vendor_credit", "Supplier credit"], ["paid_expense", "Paid expense"], ["receipt", "Receipt"],
  ["vendor_payment", "Supplier payment"], ["customer_refund", "Customer refund"],
  ["vendor_refund", "Supplier refund"], ["customer_advance", "Customer advance"],
  ["vendor_advance", "Supplier advance"], ["transfer", "Transfer"],
  ["manual_journal", "Manual journal"], ["controlled_adjustment", "Controlled adjustment"],
  ["opening_balance", "Opening balance"]
] as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DocumentDirectoryPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
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

  return (
    <main className={styles.main}>
      <p className="eyebrow">Finance workspace</p>
      <h1>Financial documents</h1>
      <p className={styles.hint}>Drafts are saved without ledger effect. Posting, settlement and delivery stay separate actions.</p>
      <section className={`panel ${styles.panel}`}>
        <h2>Create a draft</h2>
        {canWriteJournal && <p><Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=manual_journal`}>New manual journal</Link></p>}
        <div className={styles.toolbar}>
          {draftTypes.filter(([type])=>type!=="opening_balance"||canPrepareOpening).map(([type, label]) => (
            <Link key={type} className="secondary" href={type==="opening_balance"?`/o/${organizationId}/settings/opening-balances`:`/o/${organizationId}/accounting/documents/new?type=${type}`}>
              New {label}
            </Link>
          ))}
          {canAdjust && <Link className="secondary" href={`/o/${organizationId}/accounting/write-offs/new`}>New bad-debt write-off</Link>}
        </div>
      </section>
      <section className={`panel ${styles.panel}`}>
        <h2>Recent sources</h2>
        {rows?.length ? (
          <div className={styles.grid}>
            <table>
              <thead><tr><th>Number</th><th>Type</th><th>Accounting date</th><th>State</th><th>Total (BDT)</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td><Link href={`/o/${organizationId}/accounting/documents/${row.id}`}>{row.documentNumber ?? "Draft"}</Link></td>
                  <td>{row.documentType.replaceAll("_", " ")}</td><td>{row.accountingDate}</td><td>{row.state}</td><td>{row.totalAmount}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>No documents yet.</p>}
      </section>
    </main>
  );
}
