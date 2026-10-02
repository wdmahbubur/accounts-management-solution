import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readReceiptRegister } from "../../../../../server/documents/customer-receipts.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";

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

  return <main className="content"><p className="eyebrow">Sales</p><h1>Customer receipts</h1><p>Receipts record cash evidence and settle receivables. Unallocated amounts remain customer trade credit.</p>
    <div className="toolbar"><Link className="primary" href={`/o/${organizationId}/sales/receipts/new`}>Record receipt</Link><Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=customer_advance`}>Record customer advance</Link></div>
    <nav className="toolbar" aria-label="Receipt status">{tabs.map(value => <Link key={value} className={tab === value ? "primary" : "secondary"} aria-current={tab === value ? "page" : undefined} href={href(value)}>{value.replaceAll("_", " ")}</Link>)}</nav>
    <form className="panel toolbar" action={`/o/${organizationId}/sales/receipts`} method="get"><input type="hidden" name="tab" value={tab}/><label>Search receipts<input type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, customer or reference"/></label><button type="submit">Search</button>{search && <Link className="secondary" href={href(tab)}>Clear</Link>}</form>
    <section className="panel"><h2>Receipts</h2>{page.items.length === 0 ? <p>No receipts match these filters.</p> : <div className="table-scroll"><table><thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Received (BDT)</th><th>Applied (BDT)</th><th>Unused trade credit (BDT)</th><th>State</th></tr></thead><tbody>{page.items.map(receipt => <tr key={receipt.id}><td><Link href={`/o/${organizationId}/sales/receipts/${receipt.id}`}>{receipt.documentNumber ?? "Draft"}</Link></td><td>{receipt.customerName}</td><td>{receipt.issueDate}</td><td>{receipt.totalAmount}</td><td>{receipt.appliedAmount}</td><td>{receipt.unusedCredit}</td><td>{receipt.state.replaceAll("_", " ")} · {receipt.settlementStatus.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>}{page.nextCursor && <p><Link className="secondary" href={href(tab, page.nextCursor)}>Next page</Link></p>}</section>
  </main>;
}
