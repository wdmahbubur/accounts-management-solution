/** A saved document can be reviewed only while its form still matches that save. */
export class DraftEditGuard {
  private currentRevision = 0;
  private savedRevision = 0;

  get revision(): number { return this.currentRevision; }
  get dirty(): boolean { return this.currentRevision !== this.savedRevision; }

  markChanged(): void { this.currentRevision += 1; }

  confirmSaved(revision: number): boolean {
    // An earlier request must not mark edits made while it was pending as saved.
    if (revision !== this.currentRevision) return false;
    this.savedRevision = revision;
    return true;
  }

  canReview(revision = this.currentRevision): boolean {
    return !this.dirty && revision === this.currentRevision;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pick(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

/** Copy editable business values, never the original document's issued evidence. */
export function duplicateTradeDraft(
  source: Record<string, unknown>,
  documentType: "invoice" | "bill",
  today: string
): Record<string, unknown> {
  if ((documentType !== "invoice" && documentType !== "bill") || source.document_type !== documentType) {
    throw new Error("A duplicate must have the same invoice or bill type as its source.");
  }
  const trade = object(source.trade);
  const rows = Array.isArray(source.lines) ? source.lines : [];
  return {
    document_type: documentType,
    state: "draft",
    party_id: source.party_id ?? null,
    issue_date: today,
    accounting_date: today,
    due_date: null,
    external_reference: null,
    description: source.description ?? "",
    currency: "BDT",
    rounding_adjustment: source.rounding_adjustment ?? "0.00",
    rounding_reason: source.rounding_reason ?? null,
    rounding_account_id: source.rounding_account_id ?? null,
    trade: {
      ...pick(trade, ["recognition_mode", "terms", "notes"]),
      original_document_id: null,
      performance_confirmed: false,
      supplier_invoice_date: null,
      supplier_invoice_key: null
    },
    lines: rows.map(value => ({
      ...pick(object(value), [
        "item_id", "item_snapshot", "description", "quantity", "unit_price", "discount_amount",
        "account_id", "cost_center_id", "cost_center_snapshot", "tax_code_id", "tax_mode"
      ]),
      id: null,
      original_line_id: null
    })),
    movement: null,
    transfer: null,
    journal_rows: [],
    allocation_plan: []
  };
}
