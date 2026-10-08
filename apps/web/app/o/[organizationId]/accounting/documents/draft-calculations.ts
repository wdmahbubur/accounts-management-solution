import { calculateDocument, calculateLine, moneyUnits, type CalculatedLine, type DocumentPreview } from "@ams/accounting";
import { ContractValidationError, parseMoneyString } from "@ams/contracts";

export interface TradeLineInput {
  id: string | null;
  original_line_id: string | null;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_code_id: string | null;
  tax_mode: "exclusive" | "inclusive";
}

export interface SavedLineTax {
  id: string | null;
  original_line_id: string | null;
  tax_code_id: string | null;
  tax_rate_snapshot: string;
  tax_mode: "exclusive" | "inclusive";
}

export interface DraftFieldIssue { field: string; message: string }
export interface TradeLineDisplay {
  amounts: CalculatedLine | null;
  issue?: DraftFieldIssue;
  notice?: string;
}
export interface TradeDraftDisplay {
  lines: TradeLineDisplay[];
  totals: DocumentPreview | null;
  issues: DraftFieldIssue[];
}

/** Accept ordinary typed amounts without rounding, exponent notation or floats. */
export function canonicalAmountInput(raw: string, allowNegative = false): string {
  const value = raw.trim();
  const pattern = allowNegative ? /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/ : /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) throw new ContractValidationError("Check this amount.", {
    amount: "Enter an amount with up to two decimal places, for example 1250.00."
  });
  const [whole, fraction = ""] = value.split(".");
  const canonical = `${whole}.${fraction.padEnd(2, "0")}`;
  // An input such as -0 is zero, not a negative monetary value.
  return parseMoneyString(canonical === "-0.00" ? "0.00" : canonical);
}

function calculationIssue(error: unknown, prefix = ""): DraftFieldIssue {
  const [field, message] = error instanceof ContractValidationError
    ? Object.entries(error.fields)[0] ?? ["amount", error.message]
    : ["amount", "The amount could not be calculated. Check the values you entered."];
  const friendly: Record<string, string> = {
    quantity: "Enter a quantity greater than zero, using up to six decimal places.",
    unit_price: "Enter a nonnegative unit price, using up to six decimal places.",
    discount: "The discount cannot be more than the line amount before discount.",
    discount_amount: "Enter a nonnegative discount with up to two decimal places.",
    tax_rate: "The selected tax rate could not be calculated. Check the tax code.",
    "rounding.amount": "The rounding adjustment must be between -0.05 and 0.05 BDT.",
    "rounding.reason": "Add a reason for this rounding adjustment.",
    "rounding.account_id": "Choose the configured rounding account."
  };
  const mapped = field === "discount" ? "discount_amount" : field;
  return { field: `${prefix}${mapped}`, message: friendly[field] ?? message };
}

/** Display only. Saving and posting still validate and calculate on the server. */
export function calculateTradeDraft(input: {
  lines: readonly TradeLineInput[];
  taxCodes: readonly { id: string; rate_percent?: string }[];
  savedLines?: readonly SavedLineTax[];
  credit?: boolean;
  rounding: { amount: string; reason: string; accountId: string };
}): TradeDraftDisplay {
  const issues: DraftFieldIssue[] = [];
  const calculationLines: Record<string, unknown>[] = [];
  const savedById = new Map(input.savedLines?.filter(line => line.id).map(line => [line.id, line]));
  const taxById = new Map(input.taxCodes.map(tax => [tax.id, tax.rate_percent]));
  const lines = input.lines.map((line, index): TradeLineDisplay => {
    const saved = line.id ? savedById.get(line.id) : undefined;
    let rate: string | undefined;
    let mode = line.tax_mode;
    if (input.credit) {
      // Credit tax comes from its original posted line, never a currently active rate.
      if (!saved || !line.original_line_id || saved.original_line_id !== line.original_line_id) {
        return { amounts: null, notice: "Save this credit to load the original line’s tax and confirm its total." };
      }
      rate = saved.tax_rate_snapshot;
      mode = saved.tax_mode;
    } else if (saved && saved.tax_code_id === line.tax_code_id) {
      rate = saved.tax_rate_snapshot;
    } else {
      rate = line.tax_code_id ? taxById.get(line.tax_code_id) : "0";
    }
    if (rate === undefined) {
      return { amounts: null, notice: "This tax rate is unavailable in the current options. Choose an available tax code, or save and check the saved preview." };
    }
    try {
      let discount: string;
      try { discount = canonicalAmountInput(line.discount_amount); }
      catch { throw new ContractValidationError("Check the discount.", { discount_amount: "Enter a valid discount." }); }
      const calculation = { quantity: line.quantity, unit_price: line.unit_price, discount_amount: discount, tax_rate: rate, tax_mode: mode };
      const amounts = calculateLine(calculation);
      calculationLines.push(calculation);
      return { amounts };
    } catch (error) {
      const issue = calculationIssue(error, `lines.${index + 1}.`);
      issues.push(issue);
      return { amounts: null, issue };
    }
  });
  let adjustment: string;
  try { adjustment = canonicalAmountInput(input.rounding.amount, true); }
  catch {
    issues.push({ field: "rounding_adjustment", message: "Enter a rounding adjustment with up to two decimal places." });
    return { lines, totals: null, issues };
  }
  const units = moneyUnits(adjustment);
  if (units < -5n || units > 5n) issues.push({ field: "rounding_adjustment", message: "The rounding adjustment must be between -0.05 and 0.05 BDT." });
  if (units !== 0n && !input.rounding.reason.trim()) issues.push({ field: "rounding_reason", message: "Add a reason for this rounding adjustment." });
  if (units !== 0n && !input.rounding.accountId) issues.push({ field: "rounding_account_id", message: "Choose the configured rounding account." });
  if (issues.length || calculationLines.length !== input.lines.length) return { lines, totals: null, issues };
  try {
    const totals = calculateDocument({
      currency: "BDT", lines: calculationLines,
      ...(units === 0n ? {} : { rounding: { amount: adjustment, reason: input.rounding.reason, account_id: input.rounding.accountId } })
    });
    return { lines, totals, issues };
  } catch (error) {
    const issue = calculationIssue(error);
    issue.field = ({ "rounding.amount": "rounding_adjustment", "rounding.reason": "rounding_reason", "rounding.account_id": "rounding_account_id" } as Record<string, string>)[issue.field] ?? issue.field;
    return { lines, totals: null, issues: [...issues, issue] };
  }
}
