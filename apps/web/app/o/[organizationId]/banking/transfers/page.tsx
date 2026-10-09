import { ContractValidationError, parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readTransferRegister, type TransferPage } from "../../../../../server/documents/transfers.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { registerHref } from "../../../../../lib/register-navigation.ts";

export const dynamic = "force-dynamic"; export const revalidate = 0;
export default async function TransfersPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>; searchParams: Promise<{ search?: string; after?: string }>;
}) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const query = await searchParams, search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const after = typeof query.after === "string" ? query.after : null;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let page: TransferPage = { items: [], nextCursor: null }, canWrite = false, forbidden = false, filterError = "";
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    canWrite = actor.capabilities.includes("banking.write");
    page = await readTransferRegister(runtime.client, actor, { search: search || null, after, limit: 50 });
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else if (error instanceof ContractValidationError || (error instanceof CommandError && error.code === "VALIDATION_FAILED")) filterError = "This page link or filter is invalid. Return to the first page or update your search.";
    else throw error;
  }
  if (forbidden) return <main className="content"><h1>Access denied</h1><p>You need banking.read to view transfers.</p></main>;
  const base = `/o/${organizationId}/banking/transfers`, firstPage = registerHref(base, { search });
  return <main className="content"><p className="eyebrow">Banking</p><h1>Transfers</h1>
    <p>Move funds between company accounts with explicit, separately coded fees. Internal principal is not income.</p>
    {canWrite && <p><Link className="primary" href={`${base}/new`}>New transfer</Link></p>}
    <form key={search} className="panel toolbar" action={base} method="get"><label>Search transfers<input type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, account or reference" /></label>
      <button type="submit">Search</button>{search && <Link href={base}>Clear search</Link>}
    </form>
    {filterError && <p role="alert">{filterError} <Link href={firstPage}>Return to first page</Link></p>}
    <section className="panel"><h2>Transfer history</h2>
      {!filterError && (page.items.length === 0 ? <p>{after ? "No more transfers match these filters." : "No transfers match these filters."}</p> : <>
        <p>Showing {page.items.length} transfers on this page{page.nextCursor ? "; more results are available below." : "."}</p>
        <div className="table-scroll"><table><thead><tr><th>Number</th><th>Date</th><th>From</th><th>To</th><th>Principal (BDT)</th><th>Fee (BDT)</th><th>State</th><th>Reference</th></tr></thead>
          <tbody>{page.items.map(row => <tr key={row.id}><td><Link href={`${base}/${row.id}`}>{row.documentNumber ?? "Draft"}</Link></td><td>{row.accountingDate}</td><td>{row.fromAccount}</td><td>{row.toAccount}</td><td>{row.amount}</td><td>{row.feeAmount}</td><td>{row.state.replaceAll("_", " ")}</td><td>{row.externalReference ?? "—"}</td></tr>)}</tbody>
        </table></div>
      </>)}
      {!filterError && (after || page.nextCursor) && <nav className="toolbar" aria-label="Transfer history pages">
        {after && <Link className="secondary" href={firstPage}>First page</Link>}
        {page.nextCursor && <Link className="secondary" href={registerHref(base, { search, after: page.nextCursor })}>Next page</Link>}
      </nav>}
    </section>
  </main>;
}
