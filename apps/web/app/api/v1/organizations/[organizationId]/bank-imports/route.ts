import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { mapStatementRows, readStatementMatrix, type StatementMapping } from "../../../../../../server/banking/statement-import.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

function mappingFrom(value: FormDataEntryValue | null, columnCount: number): StatementMapping {
  let raw: unknown;
  try { raw = JSON.parse(String(value ?? "")); } catch { throw CommandError.validation({ mapping: "Select the statement columns." }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw CommandError.validation({ mapping: "Select the statement columns." });
  const input = raw as Record<string, unknown>;
  const index = (name: string, required: boolean): number | undefined => {
    const value = input[name];
    if (value === undefined && !required) return undefined;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= columnCount) throw CommandError.validation({ mapping: `Choose a valid ${name} column.` });
    return value as number;
  };
  const result: StatementMapping = { date: index("date", true)!, description: index("description", true)! };
  const amount = index("amount", false); const debit = index("debit", false); const credit = index("credit", false);
  if ((amount === undefined) === (debit === undefined || credit === undefined)) throw CommandError.validation({ mapping: "Choose a signed amount column or both debit and credit columns." });
  if (amount !== undefined) result.amount = amount; else { result.debit = debit; result.credit = credit; }
  for (const key of ["valueDate", "balance", "reference"] as const) {
    const value = index(key, false);
    if (value !== undefined) result[key] = value;
  }
  if (new Set(Object.values(result)).size !== Object.values(result).length) throw CommandError.validation({ mapping: "Each field must use a different column." });
  return result;
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
    const form = await request.formData();
    const accountId = parseUuid(String(form.get("cash_account_id") ?? ""), "cash_account_id");
    const file = form.get("file");
    if (!(file instanceof File)) throw CommandError.validation({ file: "Choose a CSV or XLSX statement file." });
    let parsed: Awaited<ReturnType<typeof readStatementMatrix>>;
    try { parsed = await readStatementMatrix(file); }
    catch (error) { throw CommandError.validation({ file: error instanceof Error ? error.message : "The statement file could not be read." }); }
    const { matrix, sha256, bytes } = parsed;
    const action = String(form.get("action") ?? "inspect");
    const expectedHash = form.get("file_sha256");
    if (action === "import" && expectedHash !== null && expectedHash !== sha256) throw CommandError.validation({ file: "The file changed after preview. Read the file and preview the rows again." });
    if (action === "inspect") return Response.json({ data: { headers: matrix[0], sample: matrix.slice(0, 6), file_sha256: sha256 }, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
    const mapping = mappingFrom(form.get("mapping"), matrix[0]!.length);
    const { rows, errors, preview, repeatedFingerprints } = mapStatementRows(matrix, mapping);
    const dates = rows.map(row => row.transaction_date).sort();
    const dateRange = { starts_on: dates[0] ?? null, ends_on: dates.at(-1) ?? null };
    if (action === "preview") {
      const matches = rows.length ? await runtime.client.rpc("count_statement_fingerprint_matches", { p_organization_id: organizationId, p_cash_account_id: accountId, p_fingerprints: [...new Set(rows.map((row) => row.fingerprint))] }) : { data: 0, error: null };
      if (matches.error?.code === "42501") throw CommandError.forbidden();
      if (matches.error?.code === "P0002") throw CommandError.notFound();
      if (matches.error) throw new Error("Statement duplicate warnings could not be checked.");
      return Response.json({ data: { headers: matrix[0], preview, row_count: rows.length + errors.length, valid_count: rows.length, errors: errors.slice(0, 100), file_sha256: sha256, repeated_fingerprint_groups: repeatedFingerprints, prior_fingerprint_groups: Number(matches.data), ...dateRange }, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action !== "import") throw CommandError.validation({ action: "Unsupported import action." });
    if (errors.length) throw CommandError.validation({ rows: `${errors.length} row(s) need correction. Review the preview before importing.` });
    if (!rows.length) throw CommandError.validation({ rows: "The statement contains no valid data rows." });
    const result = await runtime.client.rpc("import_bank_statement_rows", { p_organization_id: organizationId, p_cash_account_id: accountId, p_file_sha256: sha256, p_source_name: file.name, p_rows: rows, p_source_content: bytes });
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23505") throw CommandError.conflict("DUPLICATE_IMPORT");
      if (result.error.code === "55000") throw CommandError.conflict("RECONCILIATION_LOCKED");
      if (result.error.code === "22023" || result.error.code === "23514") throw CommandError.validation({ rows: "The account or statement rows are no longer eligible. Review the statement and try again." });
      throw new Error("The statement import could not be saved.");
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("The saved import could not be confirmed.");
    const saved = result.data as Record<string, unknown>;
    return Response.json({ data: { ...saved, cash_account_id: accountId, ...(saved.duplicate === true ? { starts_on: null, ends_on: null } : dateRange) }, meta: { request_id: requestId } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
