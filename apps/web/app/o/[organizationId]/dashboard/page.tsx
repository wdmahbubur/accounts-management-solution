import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { bangladeshDate } from "../../../../lib/date.ts";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Dashboard = {
  company: { id: string; name: string; timezone: string };
  filters: { from: string; to: string; as_of: string };
  generated_at: string;
  ledger_cutoff_at: string;
  provisional: boolean;
  data: {
    empty: boolean;
    exceptions: { code: string; message: string }[];
    performance?: { revenue: string; expenses: string; net_profit: string; provisional: boolean };
    liquidity?: { closing_cash_equivalents: string; provisional: boolean; unclassified_count: number };
    balance_sheet?: { assets: string; difference: string };
    trend?: { month: string; revenue: string; profit: string }[];
    cutover_detail_start?: string;
    receivables?: { net_trade: string; overdue: string; credits: string; as_of: string; provisional: boolean };
    payables?: { net_trade: string; overdue: string; due_in_30_days: string; credits: string; as_of: string; provisional: boolean };
    recent_events?: { action: string; entity_type: string; created_at: string }[];
  };
};

const validDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const money = (value: string | undefined) => value && /^-?(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(value) ? value : "0.00";
const label = (value: string) => {
  const words = value.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
function eventTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  } catch {
    return value;
  }
}

function Metric({ title, value, detail, href }: { title: string; value: string; detail?: string; href?: string }) {
  const content = <><span>{title}</span><strong><span>BDT</span> {money(value)}</strong>{detail && <small>{detail}</small>}</>;
  return <article className={styles.metric}>{href ? <Link href={href}>{content}</Link> : content}</article>;
}

export default async function OrganizationDashboardPage({
  params,
  searchParams
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ from?: string; to?: string; as_of?: string }>;
}) {
  let organizationId: ReturnType<typeof parseOrganizationId>;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const query = await searchParams;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let actor;
  try { actor = await resolveActorContext(organizationId, runtime.dependencies); }
  catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    throw error;
  }
  const canReadReports = actor.capabilities.includes("reports.read");
  const canReadAr = actor.capabilities.includes("dues.read") || actor.capabilities.includes("sales.read");
  const canReadAp = actor.capabilities.includes("dues.read") || actor.capabilities.includes("purchases.read");
  if (!canReadReports && !canReadAr && !canReadAp) {
    return <main className="content"><h1>Dashboard unavailable</h1><p>You do not have permission to view financial dashboard information.</p></main>;
  }

  const today = bangladeshDate();
  const from = query.from ?? `${today.slice(0, 4)}-01-01`;
  const to = query.to ?? today;
  const asOf = query.as_of ?? today;
  if (!validDate(from) || !validDate(to) || !validDate(asOf) || from > to) {
    return <main className="content"><h1>Company dashboard</h1><p role="alert">Enter valid dates and make sure the start date is before the end date.</p></main>;
  }

  const result = await runtime.client.rpc("read_finance_dashboard", {
    p_organization_id: organizationId, p_from: from, p_to: to, p_as_of: asOf
  });
  if (result.error) {
    if (result.error.code === "42501") return <main className="content"><h1>Dashboard unavailable</h1><p>You do not have permission to view these financial metrics.</p></main>;
    if (result.error.code === "22023") return <main className="content"><h1>Company dashboard</h1><p role="alert">Choose a report period no longer than 800 days.</p></main>;
    throw new Error("Dashboard could not be loaded.");
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("Invalid dashboard snapshot.");
  const snapshot = result.data as Dashboard;
  if (!snapshot.data || !snapshot.company || !snapshot.filters || !Array.isArray(snapshot.data.exceptions)) throw new Error("Invalid dashboard data.");
  const data = snapshot.data;
  const months = data.trend ?? [];
  const peak = Math.max(1, ...months.map(item => Math.max(Number(item.revenue) || 0, Math.abs(Number(item.profit) || 0))));
  const period = `${snapshot.filters.from} to ${snapshot.filters.to}`;

  return <main className={`content ${styles.dashboard}`}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{snapshot.company.name}</p><h1>Financial overview</h1><p className={styles.subtitle}>BDT accrual books · {snapshot.company.timezone}</p></div>
      {actor.capabilities.includes("company.update") && <Link className={styles.setupLink} href={`/o/${organizationId}/settings/setup`}>Company setup</Link>}
    </header>
    <form method="get" className={styles.filters} aria-label="Dashboard dates">
      <label>Performance from<input required type="date" name="from" defaultValue={snapshot.filters.from} /></label>
      <label>Through<input required type="date" name="to" defaultValue={snapshot.filters.to} /></label>
      <label>Balances as of<input required type="date" name="as_of" defaultValue={snapshot.filters.as_of} /></label>
      <button type="submit">Apply dates</button>
    </form>

    {data.empty && <section className={`panel ${styles.empty}`}><h2>No posted activity yet</h2><p>Once you post opening balances, invoices, bills, expenses or cash entries, this overview will use the company ledger.</p><div className={styles.quickLinks}>
      {["journal.write","documents.read","accounting.read"].every(capability=>actor.capabilities.includes(capability)) && <Link href={`/o/${organizationId}/settings/opening-balances`}>Set up opening balances</Link>}
      {actor.capabilities.includes("sales.write") && <Link href={`/o/${organizationId}/sales/invoices`}>Open invoices</Link>}
    </div></section>}

    {data.exceptions.length > 0 && <section className={`panel ${styles.notices}`} aria-label="Provisional report notices"><h2>Needs attention</h2><ul>{data.exceptions.map(item => <li key={item.code}>{item.message}</li>)}</ul></section>}

    {data.performance && <>
      <section className={styles.metricSection} aria-labelledby="performance-heading"><div className={styles.sectionHeading}><h2 id="performance-heading">Performance</h2><p>{period} · balances as of {snapshot.filters.as_of}</p></div><div className={styles.metrics}>
        <Metric title="Earned revenue" value={data.performance.revenue} detail={data.performance.provisional ? "Provisional" : period} href={`/o/${organizationId}/reports/profit-loss?${new URLSearchParams({ from, to })}`} />
        <Metric title="Expenses" value={data.performance.expenses} detail="Accrual basis" href={`/o/${organizationId}/reports/profit-loss?${new URLSearchParams({ from, to })}`} />
        <Metric title="Net profit" value={data.performance.net_profit} detail={data.performance.provisional ? "Provisional" : "Posted + approved opening totals"} href={`/o/${organizationId}/reports/profit-loss?${new URLSearchParams({ from, to })}`} />
        {data.liquidity && <Metric title="Cash and bank" value={data.liquidity.closing_cash_equivalents} detail={`Cash equivalents · as of ${snapshot.filters.as_of}${data.liquidity.provisional ? " · provisional" : ""}`} href={`/o/${organizationId}/reports/cash-flow?${new URLSearchParams({ from: from <= asOf ? from : asOf, to: asOf })}`} />}
        {data.balance_sheet && <Metric title="Total assets" value={data.balance_sheet.assets} detail={`Balance Sheet as of ${snapshot.filters.as_of}`} href={`/o/${organizationId}/reports/balance-sheet?as_of=${snapshot.filters.as_of}`} />}
      </div></section>
      <section className={`panel ${styles.trend}`}><div className={styles.sectionHeading}><h2>Monthly revenue and net profit</h2><p>Ledger detail from {data.cutover_detail_start ?? period.split(" to ")[0]}</p></div>
        {months.length === 0 ? <p>No ledger months in this date range.</p> : <>
          <div className={styles.chart} role="img" aria-label="Monthly revenue and net profit chart; table below contains exact amounts">
            {months.map(item => <div className={styles.month} key={item.month}>
              <div className={styles.bars}>
                <span className={styles.revenue} style={{ height: `${Math.max(2, (Number(item.revenue) || 0) / peak * 100)}%` }} title={`Revenue BDT ${money(item.revenue)}`} />
                <span className={styles.profit} style={{ height: `${Math.max(2, Math.abs(Number(item.profit) || 0) / peak * 100)}%` }} title={`Net profit BDT ${money(item.profit)}`} />
              </div><span>{item.month.slice(0, 7)}</span>
            </div>)}
          </div>
          <p className={styles.legend}><span><span className={styles.legendRevenue} /> Revenue</span><span><span className={styles.legendProfit} /> Net profit</span></p>
          <details className={styles.disclosure}><summary>View exact monthly amounts</summary><div className="table-scroll"><table><thead><tr><th scope="col">Month</th><th scope="col" className={styles.amount}>Revenue (BDT)</th><th scope="col" className={styles.amount}>Net profit (BDT)</th></tr></thead><tbody>{months.map(item => <tr key={item.month}><th scope="row">{item.month.slice(0, 7)}</th><td className={styles.amount}>{money(item.revenue)}</td><td className={styles.amount}>{money(item.profit)}</td></tr>)}</tbody></table></div></details>
        </>}
        <p className={styles.note}>Approved pre-cutover year-to-date opening summaries are included in headline totals, but are not distributed across these months.</p>
      </section>
    </>}

    {(data.receivables || data.payables) && <section className={styles.metricSection} aria-labelledby="dues-heading"><div className={styles.sectionHeading}><h2 id="dues-heading">Customer and supplier balances</h2><p>As of {snapshot.filters.as_of}</p></div><div className={styles.metrics}>
      {data.receivables && <>
        <Metric title="Receivables" value={data.receivables.net_trade} detail={`Open customer balances · as of ${data.receivables.as_of}${data.receivables.provisional ? " · provisional" : ""}`} href={`/o/${organizationId}/reports/receivables?as_of=${asOf}`} />
        <Metric title="Overdue receivables" value={data.receivables.overdue} detail={`Unapplied customer credits: BDT ${money(data.receivables.credits)}`} href={`/o/${organizationId}/reports/receivables?as_of=${asOf}`} />
      </>}
      {data.payables && <>
        <Metric title="Payables" value={data.payables.net_trade} detail={`Open supplier balances · as of ${data.payables.as_of}${data.payables.provisional ? " · provisional" : ""}`} href={`/o/${organizationId}/reports/payables?as_of=${asOf}`} />
        <Metric title="Overdue payables" value={data.payables.overdue} detail={`Due within 30 days: BDT ${money(data.payables.due_in_30_days)}`} href={`/o/${organizationId}/reports/payables?as_of=${asOf}`} />
      </>}
    </div></section>}

    {data.recent_events && <section className={`panel ${styles.activity}`}><h2>Recent company activity</h2>{data.recent_events.length === 0 ? <p>No recent audited activity.</p> : <ul>{data.recent_events.map((event, index) => <li key={`${event.created_at}:${index}`}><div><strong>{label(event.action)}</strong><span>{label(event.entity_type)}</span></div><time dateTime={event.created_at}>{eventTime(event.created_at, snapshot.company.timezone)}</time></li>)}</ul>}</section>}

    <section className={`panel ${styles.moduleSection}`}><h2>Quick links</h2><nav className={styles.modules} aria-label="Company modules">
      {actor.capabilities.includes("sales.read") && <Link href={`/o/${organizationId}/sales/invoices`}>Sales and invoices</Link>}
      {actor.capabilities.includes("purchases.read") && <Link href={`/o/${organizationId}/purchases/bills`}>Purchases and bills</Link>}
      {(canReadReports || canReadAr || canReadAp) && <Link href={`/o/${organizationId}/reports`}>Reports</Link>}
      {actor.capabilities.includes("accounting.read") && <Link href={`/o/${organizationId}/accounting/periods`}>Fiscal periods</Link>}
      {actor.capabilities.includes("banking.read") && <Link href={`/o/${organizationId}/banking/accounts`}>Cash and bank</Link>}
      {actor.capabilities.includes("users.read") && <Link href={`/o/${organizationId}/settings/users`}>Users and roles</Link>}
    </nav></section>
    <details className={`${styles.disclosure} ${styles.snapshot}`}><summary>Snapshot details · {snapshot.provisional ? "Provisional data present" : "Posted snapshot"}</summary><dl><div><dt>Ledger cutoff</dt><dd>{snapshot.ledger_cutoff_at}</dd></div><div><dt>Dashboard generated</dt><dd>{snapshot.generated_at}</dd></div></dl></details>
  </main>;
}
