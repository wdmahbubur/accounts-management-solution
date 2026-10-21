import {CompanyCurrency} from '../../../../../components/finance/company-currency.tsx';
import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readInvoiceRegister, type InvoiceTab } from "../../../../../server/documents/invoice-register.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { InvoiceFilters } from "./invoice-filters.tsx";
import styles from "../../../../../components/finance/finance.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const tabs: [InvoiceTab, string][] = [["all", "All"], ["drafts", "Drafts"], ["awaiting_approval", "Awaiting approval"], ["posted", "Posted"]];

export default async function InvoiceRegisterPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ tab?: string | string[]; search?: string | string[]; after?: string | string[] }>;
}) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const query = await searchParams;
  const tab = (tabs.some(([value]) => value === query.tab) ? query.tab : "all") as InvoiceTab;
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const after = typeof query.after === "string" ? query.after : undefined;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let page: Awaited<ReturnType<typeof readInvoiceRegister>> | undefined;
  let userId = "";
  let forbidden = false;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    userId = actor.userId;
    page = await readInvoiceRegister(runtime.client, actor, { status: tab, search: search || null, after: after ?? null, limit: 50 });
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else failure = error;
  }
  if (forbidden) return <main className="content"><h1>Access denied</h1><p>You need sales.read to view invoices.</p></main>;
  if (failure) throw failure;
  if (!page) throw new Error("Invoice register response was empty.");
  const makeHref = (nextTab: InvoiceTab, after?: string) => {
    const queryParams = new URLSearchParams(); queryParams.set("tab", nextTab);
    if (search) queryParams.set("search", search);
    if (after) queryParams.set("after", after);
    return `/o/${organizationId}/sales/invoices?${queryParams.toString()}`;
  };

  return <main className="content">
    <header className={styles.pageHeader}><div><p className="eyebrow">Sales</p><h1>Invoices</h1><p>Track customer invoices, outstanding balances and delivery.</p></div>
      <div className={styles.actions}><Link className="primary" href={`/o/${organizationId}/sales/invoices/new`}>Create invoice</Link><Link className="secondary" href={`/api/v1/organizations/${organizationId}/invoices/export?tab=${tab}${search ? `&search=${encodeURIComponent(search)}` : ""}`}>Export CSV</Link></div>
    </header>
    <nav className={styles.tabs} aria-label="Invoice status">{tabs.map(([value, label]) => <Link key={value} aria-current={tab === value ? "page" : undefined} href={makeHref(value)}>{label}</Link>)}</nav>
    <InvoiceFilters organizationId={organizationId} userId={userId} tab={tab} search={search}/>
    <section className={`panel ${styles.register}`}><div className={styles.listHeading}><h2>{tabs.find(([value]) => value === tab)?.[1]} invoices</h2><p>Amounts in <CompanyCurrency /></p></div>
      {page.items.length === 0 ? <p className={styles.empty}>No invoices match these filters.</p> : <div className={`table-scroll ${styles.scroll}`} tabIndex={0} role="region" aria-label="Invoice register"><table>
        <thead><tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Dates</th><th scope="col" className={styles.amount}>Total</th><th scope="col" className={styles.amount}>Outstanding</th><th scope="col">Settlement</th><th scope="col">Delivery</th><th scope="col">Actions</th></tr></thead>
        <tbody>{page.items.map(invoice => <tr key={invoice.id}>
          <th scope="row"><Link href={`/o/${organizationId}/sales/invoices/${invoice.id}`}>{invoice.documentNumber ?? "Draft"}</Link></th><td>{invoice.customerName}</td>
          <td>{invoice.issueDate}<span className={styles.meta}>Due {invoice.dueDate ?? "—"}</span>{invoice.overdue && <span className={styles.warning}>Overdue</span>}</td>
          <td className={styles.amount}>{invoice.totalAmount}</td><td className={styles.amount}>{invoice.residualAmount ?? "—"}</td>
          <td><span className={styles.badge}>{invoice.settlementStatus.replaceAll("_", " ")}</span></td><td>{invoice.deliveryStatus.replaceAll("_", " ")}</td>
          <td><div className={styles.actions}><Link href={`/o/${organizationId}/sales/invoices/${invoice.id}`}>Open</Link><Link href={`/o/${organizationId}/sales/invoices/new?copy=${invoice.id}`}>Duplicate</Link></div></td>
        </tr>)}</tbody></table></div>}
      <p className={styles.filterHint}>Posting, settlement and delivery are separate statuses. Drafts do not affect the ledger.</p>
      {page.nextCursor && <p className={styles.pagination}><Link className="secondary" href={makeHref(tab, page.nextCursor)}>Next page</Link></p>}
    </section>
  </main>;
}
