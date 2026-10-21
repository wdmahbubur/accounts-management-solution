import { parseMoneyString } from '@ams/contracts';

function canonicalReportMoney(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid report amount');
  const [whole, fraction = ''] = value.split('.');
  return parseMoneyString(`${whole}.${fraction.padEnd(2, '0')}`);
}

export type ReportLine = { text: string; heading?: boolean };
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid report section');
  return value as Row;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('Invalid report rows');
  return value.map(row);
}
function amount(value: unknown): string {
  return `BDT ${canonicalReportMoney(value)}`;
}
function label(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid report label');
  return value;
}
const title = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

/** Presentation of the captured snapshot only. Never reads newer accounting data. */
export function reportPresentation(type: string, value: unknown): ReportLine[] {
  const lines: ReportLine[] = [];
  const heading = (text: string) => lines.push({ text, heading: true });
  const field = (name: string, value: unknown) => lines.push({ text: `${name}: ${amount(value)}` });
  if (type === 'profit_and_loss' || type === 'profit_loss') {
    const data = row(value), periods = row(data.periods), totals = row(data.totals);
    const accounts = rows(data.accounts);
    const directMapped = accounts.some(account => account.account_type === 'expense' && account.report_group === 'cost_of_sales');
    for (const [period, prefix] of [[periods.current, ''], [periods.comparison, 'comparison_']] as const) {
      if (!period) continue;
      const range = row(period);
      heading(`${prefix ? 'Comparison' : 'Current period'}: ${label(range.from)} to ${label(range.to)}`);
      for (const key of ['revenue', 'direct_costs', 'gross_profit', 'operating_costs', 'other_income', 'other_expenses', 'net_profit']) {
        if(key==='gross_profit'&&!directMapped)lines.push({text:'Gross profit: Not shown (no direct-cost accounts mapped)'});
        else field(title(key), totals[`${prefix}${key}`]);
      }
    }
    heading('Account detail');
    for (const account of accounts) {
      const raw = canonicalReportMoney(account.current_amount);
      const display = account.account_type === 'expense' && raw !== '0.00' ? raw.startsWith('-') ? raw.slice(1) : `-${raw}` : raw;
      lines.push({ text: `${label(account.account_code)} - ${label(account.account_name)} (${title(label(account.report_group))}): BDT ${display}` });
      if (periods.comparison) {
        const compare = canonicalReportMoney(account.comparison_amount);
        const signed = account.account_type === 'expense' && compare !== '0.00' ? compare.startsWith('-') ? compare.slice(1) : `-${compare}` : compare;
        lines.push({ text: `Comparison: BDT ${signed}` });
      }
      if (account.current_evidence_reference) lines.push({ text: `Imported YTD evidence: ${label(account.current_evidence_reference)}` });
    }
    for (const warning of data.warnings as unknown[]) lines.push({ text: label(warning) });
  } else if (type === 'balance_sheet') {
    const data = row(value);
    for (const name of ['current', 'comparison']) {
      if (!data[name]) continue;
      const statement = row(data[name]);
      heading(`${title(name)}: as of ${label(statement.as_of)}`);
      for (const key of ['assets', 'liabilities', 'equity_accounts', 'untransferred_earnings', 'equity', 'liabilities_and_equity', 'difference']) field(title(key), statement[key]);
      heading('Account detail');
      for (const account of rows(statement.accounts)) lines.push({ text: `${title(label(account.section))} - ${label(account.account_code)} - ${label(account.account_name)}: ${amount(account.amount)}` });
    }
  } else if (type === 'customer_statement' || type === 'vendor_statement') {
    const data = row(value);
    heading(label(row(data.party).name));
    lines.push({ text: `${label(data.from)} to ${label(data.to)}` });
    for (const key of ['opening', 'movements', 'closing']) {
      const balances = row(data[key]);
      heading(title(key)); field('Trade balance', balances.trade); field('Advances', balances.advances);
    }
    heading('Dated activity');
    for (const event of rows(data.events)) {
      lines.push({ text: `${label(event.date)} - ${title(label(event.event_type ?? event.document_type))} - ${typeof event.document_number === 'string' ? event.document_number : 'Document reference unavailable'}` });
      field('Movement', event.balance_effect); field('Running balance', event.running_balance);
      if (event.reference) lines.push({ text: `Reference: ${label(event.reference)}` });
      if (event.detail) lines.push({ text: label(event.detail) });
    }
    heading('Control reconciliation');
    for (const [key, amount] of Object.entries(row(data.control_bridge))) field(title(key), amount);
  } else if (type === 'trial_balance') {
    heading('Account balances');
    for (const account of rows(value)) {
      heading(`${label(account.account_code)} - ${label(account.account_name)}`);
      for (const key of ['opening_balance', 'movement_debit', 'movement_credit', 'closing_debit', 'closing_credit']) field(title(key), account[key]);
    }
  } else throw new Error('Unsupported PDF report');
  return lines;
}
