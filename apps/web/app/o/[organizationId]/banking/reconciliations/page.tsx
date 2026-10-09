import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { readReconciliationHistory } from "../../../../../server/banking/reconciliations.ts";
import { parseReconciliationFilters, reconciliationDate, reconciliationHistoryQuery, reconciliationLinkLabel, reconciliationStatusLabels,
  type ReconciliationAccount, type ReconciliationHistory, type ReconciliationFilters } from "../../../../../lib/reconciliation-history.ts";
import { ReconciliationStart } from "./start.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Search = Record<string, string | string[] | undefined>;
const timestampLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default async function ReconciliationsPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Search> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const root = `/o/${organizationId}/banking/reconciliations`;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  const query = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) queryParams.append(name, item);
  let filters: ReconciliationFilters = { cashAccountId: null, status: null, page: 1 };
  let filterError = "";
  try { filters = parseReconciliationFilters(queryParams); }
  catch { filterError = "Choose a valid account, status and page to find a reconciliation."; }
  let accounts: ReconciliationAccount[] = [];
  let history: ReconciliationHistory | null = null;
  let canWrite = false, canRead = false, loadError = "";
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    canWrite = actor.capabilities.includes("banking.write");
    canRead = actor.capabilities.includes("banking.read");
    if (!canRead && !canWrite) throw CommandError.forbidden();
    if (canRead && !filterError) {
      try { history = await readReconciliationHistory(runtime.client, actor, filters); accounts = history.accounts; }
      catch (error) {
        if (error instanceof CommandError) throw error;
        loadError = "Reconciliation history could not be loaded. Your saved sessions are unchanged.";
      }
    } else if (canWrite && !canRead) {
      const result = await runtime.client.rpc("list_operational_cash_accounts", { p_organization_id: organizationId });
      if (result.error?.code === "42501") throw CommandError.forbidden();
      if (result.error?.code === "P0002") throw CommandError.notFound();
      if (result.error || !Array.isArray(result.data)) throw new Error("Cash accounts could not be loaded.");
      accounts = result.data.map((value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid account row.");
        const row = value as Record<string, unknown>;
        if (typeof row.name !== "string" || typeof row.kind !== "string") throw new Error("Invalid account row.");
        return { id: parseUuid(row.id), name: row.name, kind: row.kind, isActive: true };
      });
      if (filters.cashAccountId && !accounts.some(account => account.id === filters.cashAccountId)) throw CommandError.notFound();
    }
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need banking.read to view reconciliation history or banking.write to start a session.</p></main>;
    throw error;
  }
  const startsOn = reconciliationDate(query.starts_on) ? query.starts_on : "";
  const endsOn = reconciliationDate(query.ends_on) ? query.ends_on : "";
  const handoffError = (query.starts_on !== undefined && !startsOn) || (query.ends_on !== undefined && !endsOn);
  const activeAccounts = accounts.filter(account => account.isActive);
  return <main className="content">
    <header><p className="eyebrow">Banking</p><h1>Reconciliations</h1><p>Resume a saved statement session or review finalized history. Matching connects statement observations to posted cash lines and does not create a ledger entry.</p></header>
    {canRead ? <section className="panel" aria-labelledby="reconciliation-history-title">
      <h2 id="reconciliation-history-title">Saved reconciliation sessions</h2>
      {filterError ? <p role="alert">{filterError} <Link href={root}>Clear filters</Link></p> : null}
      {loadError ? <p role="alert">{loadError} <a href={`${root}?${reconciliationHistoryQuery(filters)}`}>Try again</a></p> : null}
      {history ? <>
        <form method="get" className="toolbar">
          <label>Account<select name="cash_account_id" defaultValue={filters.cashAccountId ?? ""}><option value="">All accounts</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.isActive ? "" : " · Archived"}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option><option value="draft">Draft</option><option value="reopened">Reopened</option><option value="finalized">Finalized</option></select></label>
          <button type="submit">Find sessions</button><Link href={root}>Clear filters</Link>
        </form>
        {history.sessions.length ? <div className="table-scroll"><table><caption>Page {history.page} · newest sessions first · times in Asia/Dhaka</caption><thead><tr><th scope="col">Account</th><th scope="col">Statement period</th><th scope="col">Statement balances (BDT)</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Open</th></tr></thead><tbody>
          {history.sessions.map(session => {
            const eventDate = session.finalizedAt ?? session.lastReopenedAt ?? session.createdAt;
            const eventLabel = session.finalizedAt ? "Finalized" : session.lastReopenedAt ? "Reopened" : "Created";
            return <tr key={session.id}><td>{session.accountName}<br/><small>{session.accountKind.replaceAll("_", " ")}{session.accountActive ? "" : " · Archived"}</small></td>
              <td><time dateTime={session.startsOn}>{session.startsOn}</time> to <time dateTime={session.endsOn}>{session.endsOn}</time></td>
              <td>Opening {session.statementOpening}<br/>Closing {session.statementClosing}</td>
              <td><strong>{reconciliationStatusLabels[session.status]}</strong><br/><small>{eventLabel} <time dateTime={eventDate}>{timestampLabel(eventDate)}</time></small>{session.reopenCount > 0 ? <><br/><small>{session.reopenCount} recorded reopen {session.reopenCount === 1 ? "event" : "events"}</small></> : null}</td>
              <td>{session.activeMatchCount} active {session.activeMatchCount === 1 ? "match" : "matches"}</td>
              {/* Keep a continuous click target when the action label wraps. */}
              <td><Link className="secondary" href={`${root}/${session.id}`}>{reconciliationLinkLabel(session, canWrite)}</Link></td></tr>;
          })}
        </tbody></table></div> : <p>{filters.cashAccountId || filters.status ? "No sessions match these filters." : filters.page > 1 ? "No sessions on this page." : "No reconciliation sessions have been created yet."}</p>}
        {(history.page > 1 || history.hasMore) ? <nav className="toolbar" aria-label="Reconciliation history pages">
          {history.page > 1 ? <Link href={`${root}?${reconciliationHistoryQuery(filters, history.page - 1)}`}>Previous page</Link> : null}
          <span>Page {history.page}</span>{history.hasMore ? <Link href={`${root}?${reconciliationHistoryQuery(filters, history.page + 1)}`}>Next page</Link> : null}
        </nav> : null}
      </> : null}
    </section> : <section className="panel"><p>Your access allows you to start a session or resume one with its saved statement dates. Viewing the full history requires banking.read.</p></section>}
    {canWrite && !filterError && !loadError ? <>
      {handoffError ? <p role="alert">The supplied statement dates were invalid. Enter the dates shown on your statement.</p> : null}
      {activeAccounts.length ? <ReconciliationStart key={`${filters.cashAccountId ?? ""}:${startsOn}:${endsOn}`} organizationId={organizationId} accounts={activeAccounts}
        defaultAccountId={activeAccounts.some(account => account.id === filters.cashAccountId) ? filters.cashAccountId ?? "" : ""} startsOn={startsOn} endsOn={endsOn}/> : <section className="panel"><h2>Start a reconciliation</h2><p>Add an active cash or bank account before starting a new session.</p><Link href={`/o/${organizationId}/banking/accounts`}>Cash and bank accounts</Link></section>}
    </> : null}
  </main>;
}
