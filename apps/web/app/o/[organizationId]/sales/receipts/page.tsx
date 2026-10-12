import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readReceiptRegister } from "../../../../../server/documents/customer-receipts.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import styles from "../../../../../components/finance/finance.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const tabs = ["all", "drafts", "awaiting_approval", "posted"] as const;
type ReceiptTab = typeof tabs[number];

export default async function ReceiptRegisterPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ tab?: string; search?: string; after?: string }>;
}) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const query = await searchParams;
  const tab = tabs.includes(query.tab as ReceiptTab) ? query.tab as ReceiptTab : "all";
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let page: Awaited<ReturnType<typeof readReceiptRegister>> | undefined;
  let forbidden = false;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    page = await readReceiptRegister(runtime.client, actor, { status: tab, search: search || null, after: query.after ?? null, limit: 50 });
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else failure = error;
  }
  if (forbidden) return <main className="content"><h1>Access denied</h1><p>You need sales.read to view customer receipts.</p></main>;
  if (failure) throw failure;
  if (!page) throw new Error("Receipt register response was empty.");
  const href = (next: ReceiptTab, after?: string) => {
    const values = new URLSearchParams({ tab: next });
    if (search) values.set("search", search);
    if (after) values.set("after", after);
    return `/o/${organizationId}/sales/receipts?${values.toString()}`;
  };

  const tabLabels: Record<ReceiptTab, string> = { all: "All", drafts: "Drafts", awaiting_approval: "Awaiting approval", posted: "Posted" };
  return <main className="content">
    <header className={styles.pageHeader}><div><p className="eyebrow">Sales</p><h1>Customer receipts</h1><p>Track money received and the invoices it settles.</p></div>
      <div className={styles.actions}><Link className="primary" href={`/o/${organizationId}/sales/receipts/new`}>Record receipt</Link><Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=customer_advance`}>Customer advance</Link></div>
    </header>
    <nav className={styles.tabs} aria-label="Receipt status">{tabs.map(value => <Link key={value} aria-current={tab === value ? "page" : undefined} href={href(value)}>{tabLabels[value]}</Link>)}</nav>
    <form key={JSON.stringify([tab, search])} className="panel toolbar" action={`/o/${organizationId}/sales/receipts`} method="get"><input type="hidden" name="tab" value={tab}/><label>Search receipts<input type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, customer or reference"/></label><button type="submit">Search</button>{search && <Link className="secondary" href={`/o/${organizationId}/sales/receipts?tab=${tab}`}>Clear</Link>}</form>
    <section className={`panel ${styles.register}`}><div className={styles.listHeading}><h2>{tabLabels[tab]} receipts</h2><p>Amounts in BDT</p></div>
      {page.items.length === 0 ? <p className={styles.empty}>No receipts match these filters.</p> : <div className={`table-scroll ${styles.scroll}`} tabIndex={0} role="region" aria-label="Receipt register"><table>
        <thead><tr><th scope="col">Receipt</th><th scope="col">Customer</th><th scope="col">Date</th><th scope="col" className={styles.amount}>Received</th><th scope="col" className={styles.amount}>Applied</th><th scope="col" className={styles.amount}>Unused trade credit</th><th scope="col">Status</th></tr></thead>
        <tbody>{page.items.map(receipt => <tr key={receipt.id}><th scope="row"><Link href={`/o/${organizationId}/sales/receipts/${receipt.id}`}>{receipt.documentNumber ?? "Draft"}</Link></th><td>{receipt.customerName}</td><td>{receipt.issueDate}</td>
          <td className={styles.amount}>{receipt.totalAmount}</td><td className={styles.amount}>{receipt.appliedAmount}</td><td className={styles.amount}>{receipt.unusedCredit}</td>
          <td><span className={styles.badge}>{receipt.state.replaceAll("_", " ")}</span><span className={styles.meta}>{receipt.settlementStatus.replaceAll("_", " ")}</span></td>
        </tr>)}</tbody></table></div>}
      <p className={styles.filterHint}>Unallocated receipt amounts remain customer trade credit. Customer advances are recorded separately.</p>
      {page.nextCursor && <p className={styles.pagination}><Link className="secondary" href={href(tab, page.nextCursor)}>Next page</Link></p>}
    </section>
  </main>;
}
