import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as accounting from "@ams/accounting";
import * as contracts from "@ams/contracts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";
import { reportMoney } from "../../apps/web/app/o/[organizationId]/reports/report-money.ts";
import { parseBalanceSheetDates } from "../../apps/web/app/o/[organizationId]/reports/balance-sheet/date-filters.ts";

const organizationId = "d937174a-7022-4b26-a1e0-7a6ebac1f485";
const partyId = "6a31db48-ecf5-455b-a043-33d1036a71ee";
const documentId = "2eb36eb2-d29b-44ae-a1d2-d8cd67e2d54f";
const common = { snapshot_id: organizationId, company: { name: "Fixture company", timezone: "Asia/Dhaka" }, generated_at: "2026-10-12T12:00:00Z", ledger_cutoff_at: "2026-10-12T12:00:00Z" };

function agingData(control) {
  return {
    as_of: "2026-10-12", timezone: "Asia/Dhaka", control_kind: control,
    buckets: { not_due: "0", days_1_30: "0", days_31_60: "0", days_61_90: "0", days_91_plus: "0", no_due_date: "0" },
    trade_debt: "0", unapplied_trade_credits: "0", net_trade_control_items: "0", trade_control_ledger: "0", trade_control_difference: "0", trade_credit_items: [],
    advances: { control_kind: control === "ar" ? "customer_advance" : "vendor_advance", normal_balance: "0", opposite_side_credits: "0", ledger_balance: "0", difference: "0", items: [] },
    items: [], net_bridge_difference: 0, provisional: false
  };
}

function statementData(scope) {
  return {
    scope, party: { id: partyId, name: "Fixture party", email: null }, from: "2026-10-01", to: "2026-10-12",
    opening: { trade: "0", advances: "0" }, movements: { trade: "0", advances: "0" }, closing: { trade: "0", advances: "0" },
    control_bridge: { trade_ledger: "0", trade_difference: "0", advance_ledger: "0", advance_difference: "0" },
    events: [], cutoff_at: common.ledger_cutoff_at, timezone: "Asia/Dhaka"
  };
}

function balanceSheetData() {
  return { current: { as_of: "2026-10-12", assets: "0", liabilities: "0", equity_accounts: "0", untransferred_earnings: "0", equity: "0", liabilities_and_equity: "0", difference: "0", accounts: [] }, comparison: null };
}
function cashFlowData() {
  return {
    from: "2026-10-01", to: "2026-10-12", opening_cash: "0", operating: "0", investing: "0", financing: "0",
    internal_transfer_inflows: "0", internal_transfer_outflows: "0", internal_transfer_net: "0", unclassified: "0", unclassified_count: 0,
    cash_equivalent_account_count: 0, closing_cash: "0", calculated_closing: "0", reconciliation_difference: "0", provisional: true,
    cash_accounts: [], activity: [], exceptions: [], cutoff_at: common.ledger_cutoff_at, timezone: "Asia/Dhaka"
  };
}
function profitLossData() {
  const totals = Object.fromEntries(["revenue", "direct_costs", "gross_profit", "operating_costs", "other_income", "other_expenses", "net_profit"].flatMap(name => [[name, "0"], [`comparison_${name}`, "0"]]));
  return { periods: { current: { from: "2026-10-01", to: "2026-10-12", ytd_summary_included: false }, comparison: null }, accounts: [], totals, warnings: [], provisional: false };
}

// Execute the actual server components with a scoped RPC response; only their
// framework/runtime edges are replaced. JSX is collected without a browser or DB.
const compiled = new Map();
async function renderReport(filename, data, capabilities, query, control) {
  if (!compiled.has(filename)) {
    const source = readFileSync(new URL(`../../apps/web/app/o/[organizationId]/reports/${filename}`, import.meta.url), "utf8");
    compiled.set(filename, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
  }
  const calls = [];
  const dependencies = name => {
    if (name === "react/jsx-runtime") { const jsx=(type,props)=>type==='company-currency'?'BDT':({type,props});return{jsx,jsxs:jsx}; }
    if (name.endsWith('/company-currency.tsx')) return {CompanyCurrency:'company-currency'};
    if (name.endsWith('/today.ts')) return {companyDate:async()=> '2026-10-12'};
    if (name === "@ams/accounting") return accounting;
    if (name === "@ams/contracts") return contracts;
    if (name === "next/link") return "a";
    if (name === "next/navigation") return { redirect: () => { throw new Error("Unexpected redirect."); } };
    if (name.endsWith(".module.css")) return {};
    if (name.endsWith("/date.ts")) return { bangladeshDate: () => "2026-10-12" };
    if (name.endsWith("/errors.ts")) return { CommandError };
    if (name.endsWith("/resolve-actor.ts")) return { resolveActorContext: async () => ({ capabilities }) };
    if (name.endsWith("/runtime.ts")) return { roleRuntime: async () => ({
      current: { organizationId }, dependencies: {}, client: { rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "list_profit_loss_options") return { error: null, data: { company: { books_start_date: "2026-01-01" }, fiscal_years: [], cost_centers: [] } };
        if (name === "read_cash_flow_review") return { error: null, data: { snapshot: { ...common, provisional: data.provisional ?? false, data }, material_digest: "a".repeat(64) } };
        return { error: null, data: { ...common, provisional: data.provisional ?? false, data } };
      } }
    }) };
    if (name.endsWith("/report-money.ts")) return { reportMoney };
    if (name.endsWith("/date-filters.ts")) return { parseBalanceSheetDates };
    if (name.endsWith("/print-button.tsx")) return { PrintStatement: () => null };
    if (name.endsWith("/report-export-button.tsx")) return { ReportExportButton: () => null };
    if (name === "./finalize-form.tsx") return { FinalizeCashFlow: () => null };
    throw new Error(`Unexpected report import: ${name}`);
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled.get(filename))(dependencies, loaded, loaded.exports);
  const component = filename === "aging-report.tsx" ? loaded.exports.AgingReport : loaded.exports.default;
  const tree = await component({ params: Promise.resolve({ organizationId }), searchParams: Promise.resolve(query), control });
  return { tree, calls };
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
function hrefs(node) {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!node || typeof node !== "object") return [];
  return [...(node.type === "a" ? [node.props.href] : []), ...hrefs(node.props?.children)];
}

test("both aging pages accept exact SQL zero strings and retain the selected scoped read", async () => {
  for (const control of ["ar", "ap"]) {
    const result = await renderReport("aging-report.tsx", agingData(control), ["dues.read"], { as_of: "2026-10-12" }, control);
    assert.match(text(result.tree), /BDT 0\.00/);
    assert.match(text(result.tree), /Open items reconcile to the control account/);
    assert.match(text(result.tree), /Advance open items reconcile to their separate control account/);
    assert.deepEqual(result.calls, [{ name: "read_aging_snapshot", args: { p_organization_id: organizationId, p_control: control, p_as_of: "2026-10-12" } }]);
    assert.deepEqual(hrefs(result.tree), []);
  }
});

test("aging retains large exact residuals, signed mismatches and permitted draft links", async () => {
  for (const control of ["ar", "ap"]) {
    const data = agingData(control);
    const amount = "9007199254740993.17";
    data.trade_debt = amount; data.net_trade_control_items = amount; data.trade_control_ledger = "9007199254740993.16"; data.trade_control_difference = "-0.01";
    data.items = [{ open_item_id: organizationId, journal_line_id: organizationId, source_document_id: documentId, document_number: "DOC-001", party_id: partyId, party_name: "Fixture party", control_kind: control, side: control === "ar" ? "debit" : "credit", reference: "Fixture reference", issue_date: "2026-10-01", due_date: null, bucket: "no_due_date", residual: amount }];
    const sourceModule = control === "ar" ? "sales" : "purchases";
    const { tree } = await renderReport("aging-report.tsx", data, [`${sourceModule}.read`, `${sourceModule}.write`], { as_of: "2026-10-12" }, control);
    assert.ok(text(tree).includes(amount));
    assert.match(text(tree), /Difference: BDT -0\.01/);
    assert.match(text(tree), /Control mismatch/);
    assert.ok(hrefs(tree).includes(`/o/${organizationId}/accounting/documents/${documentId}`));
    assert.ok(hrefs(tree).includes(`/o/${organizationId}/accounting/documents/new?type=${control === "ar" ? "receipt" : "vendor_payment"}&party_id=${partyId}`));
  }
});

test("aging permission denial performs no report read or rendered financial disclosure", async () => {
  for (const control of ["ar", "ap"]) {
    const result = await renderReport("aging-report.tsx", agingData(control), [control === "ar" ? "purchases.read" : "sales.read"], { as_of: "2026-10-12" }, control);
    assert.match(text(result.tree), /Access denied/);
    assert.deepEqual(result.calls, []);
  }
});

test("selected customer and supplier statements render SQL zero bridges without changing report identity", async () => {
  for (const scope of ["customer", "vendor"]) {
    const result = await renderReport("statements/page.tsx", statementData(scope), ["dues.read"], { scope, party_id: partyId, from: "2026-10-01", to: "2026-10-12" });
    assert.match(text(result.tree), /Opening plus movements equals closing/);
    assert.match(text(result.tree), /Control reconciled/);
    assert.match(text(result.tree), /BDT 0\.00/);
    assert.deepEqual(result.calls, [{ name: "capture_report_export_snapshot", args: { p_organization_id: organizationId, p_report_type: `${scope}_statement`, p_filters: { party_id: partyId, from: "2026-10-01", to: "2026-10-12" } } }]);
    assert.deepEqual(hrefs(result.tree), []);
  }
});

test("selected statements preserve signed source movements and exact reconciliation", async () => {
  const data = statementData("customer");
  data.opening.trade = "75.25"; data.movements.trade = "-25.5"; data.closing.trade = "49.75"; data.control_bridge.trade_ledger = "49.75";
  data.events = [{ event_id: documentId, date: "2026-10-12", control_kind: "ar", document_type: "customer_credit", source_document_id: documentId, document_number: "CR-001", reference: null, related_document_id: null, related_document: null, detail: null, balance_effect: "-25.5", running_balance: "49.75" }];
  const { tree } = await renderReport("statements/page.tsx", data, ["sales.read"], { party_id: partyId, from: "2026-10-01", to: "2026-10-12" });
  assert.match(text(tree), /BDT -25\.50/);
  assert.match(text(tree), /Opening plus movements equals closing/);
  assert.ok(hrefs(tree).includes(`/o/${organizationId}/accounting/documents/${documentId}`));
  assert.equal(data.movements.trade, "-25.5");
});

test("report money and actual rendering reject malformed or numeric money responses", async () => {
  assert.equal(reportMoney("-9007199254740993.17"), "-9007199254740993.17");
  assert.equal(reportMoney("3.5"), "3.50");
  for (const value of [0, null, undefined, {}, [], "", "1e3", "01", "1.001", "1,000.00", "1000000000000000000.00"]) assert.throws(() => reportMoney(value));
  const aging = agingData("ar"); aging.trade_control_difference = 0;
  await assert.rejects(() => renderReport("aging-report.tsx", aging, ["dues.read"], { as_of: "2026-10-12" }, "ar"), /Invalid report money/);
  const statement = statementData("customer"); statement.control_bridge.trade_difference = "not money";
  await assert.rejects(() => renderReport("statements/page.tsx", statement, ["dues.read"], { party_id: partyId, from: "2026-10-01", to: "2026-10-12" }), /Invalid report money/);
});

test("empty Balance Sheet totals and comparison render canonical zeros without concealing imbalance", async () => {
  const data = balanceSheetData();
  data.comparison = { ...data.current, as_of: "2026-09-30" };
  const query = { as_of: "2026-10-12", comparison_as_of: "2026-09-30" };
  const result = await renderReport("balance-sheet/page.tsx", data, ["reports.read"], query);
  assert.match(text(result.tree), /Balanced · no balancing plug was added/);
  assert.match(text(result.tree), /Comparison totals: assets BDT 0\.00/);
  assert.deepEqual(result.calls, [{ name: "capture_report_export_snapshot", args: { p_organization_id: organizationId, p_report_type: "balance_sheet", p_filters: query } }]);
  data.current.assets = "9007199254740993.17"; data.current.liabilities = "9007199254740993.18"; data.current.liabilities_and_equity = "9007199254740993.18"; data.current.difference = "-0.01";
  const unbalanced = await renderReport("balance-sheet/page.tsx", data, ["reports.read"], query);
  assert.match(text(unbalanced.tree), /Out of balance/);
  assert.ok(text(unbalanced.tree).includes("9007199254740993.17"));
  assert.ok(text(unbalanced.tree).includes("-0.01"));
});

test("empty Cash flow remains provisional until configured and retains its exact read filters", async () => {
  const data = cashFlowData();
  const query = { from: "2026-10-01", to: "2026-10-12" };
  const result = await renderReport("cash-flow/page.tsx", data, ["reports.read"], query);
  assert.match(text(result.tree), /BDT 0\.00/);
  assert.match(text(result.tree), /Provisional · configure at least one cash-equivalent account/);
  assert.deepEqual(result.calls, [{ name: "read_cash_flow_review", args: { p_organization_id: organizationId, p_from: query.from, p_to: query.to, p_finalization_id: null } }]);
  data.cash_equivalent_account_count = 1; data.provisional = false;
  data.cash_accounts = [{ cash_account_id: documentId, account_id: partyId, account_code: "1000", account_name: "Bank", opening: "0", closing: "0" }];
  const configured = await renderReport("cash-flow/page.tsx", data, ["reports.read"], query);
  assert.match(text(configured.tree), /Classified cash movements reconcile to the ledger/);
  assert.deepEqual(hrefs(configured.tree), []);
});

test("Cash flow keeps signed movement, mismatch and classification warnings", async () => {
  const data = cashFlowData();
  data.cash_equivalent_account_count = 1; data.provisional = false; data.opening_cash = "10"; data.operating = "-3.5"; data.calculated_closing = "6.5"; data.closing_cash = "6.49"; data.reconciliation_difference = "-0.01";
  const query = { from: "2026-10-01", to: "2026-10-12" };
  const mismatch = await renderReport("cash-flow/page.tsx", data, ["reports.read"], query);
  assert.match(text(mismatch.tree), /BDT -3\.50/);
  assert.match(text(mismatch.tree), /Cash reconciliation mismatch/);
  data.provisional = true; data.unclassified_count = 1;
  const provisional = await renderReport("cash-flow/page.tsx", data, ["reports.read"], query);
  assert.match(text(provisional.tree), /Provisional · 1 cash-line movement\(s\) need classification/);
  assert.match(text(provisional.tree), /Classification exceptions/);
});

test("P&L uses exact two-decimal totals while keeping expense direction and provisional warnings", async () => {
  const data = profitLossData(), query = { from: "2026-10-01", to: "2026-10-12" };
  const empty = await renderReport("profit-loss/page.tsx", data, ["reports.read"], query);
  assert.match(text(empty.tree), /RevenueBDT 0\.00/);
  assert.match(text(empty.tree), /Net profitBDT 0\.00/);
  assert.deepEqual(empty.calls, [
    { name: "list_profit_loss_options", args: { p_organization_id: organizationId } },
    { name: "capture_report_export_snapshot", args: { p_organization_id: organizationId, p_report_type: "profit_and_loss", p_filters: query } }
  ]);
  data.provisional = true; data.warnings = ["Fixture reporting warning"];
  data.totals.operating_costs = "3.5"; data.totals.net_profit = "-3.5";
  data.accounts = [{ account_id: partyId, account_code: "5000", account_name: "Operating costs", account_type: "expense", report_group: "operating_expense", current_amount: "-3.5", comparison_amount: "0", current_ledger_debit: "3.5", current_ledger_credit: "0", current_summary_debit: "0", current_summary_credit: "0", comparison_ledger_debit: "0", comparison_ledger_credit: "0", comparison_summary_debit: "0", comparison_summary_credit: "0", current_evidence_reference: null }];
  const populated = await renderReport("profit-loss/page.tsx", data, ["reports.read"], query);
  assert.match(text(populated.tree), /Operating costsBDT 3\.50/);
  assert.match(text(populated.tree), /Net profitBDT -3\.50/);
  assert.match(text(populated.tree), /Operating costs3\.50Posted ledger/);
  assert.match(text(populated.tree), /Provisional report/);
  assert.match(text(populated.tree), /Fixture reporting warning/);
  assert.equal(data.accounts[0].current_amount, "-3.5");
  data.periods.comparison = { from: "2026-09-01", to: "2026-09-30", ytd_summary_included: false };
  const comparison = await renderReport("profit-loss/page.tsx", data, ["reports.read"], { ...query, comparison_from: "2026-09-01", comparison_to: "2026-09-30" });
  assert.match(text(comparison.tree), /Operating costs3\.500\.00Posted ledger/);
  assert.ok(!text(comparison.tree).includes("-0.00"));
});

test("balance, cash flow and P&L still deny readers without report access before any RPC", async () => {
  for (const [filename, data] of [["balance-sheet/page.tsx", balanceSheetData()], ["cash-flow/page.tsx", cashFlowData()], ["profit-loss/page.tsx", profitLossData()]]) {
    const denied = await renderReport(filename, data, [], {});
    assert.match(text(denied.tree), /Access denied/);
    assert.deepEqual(denied.calls, []);
  }
});
