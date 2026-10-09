export const mappingKeys = ["date", "description", "amount", "debit", "credit", "valueDate", "balance", "reference"] as const;
export type MappingKey = typeof mappingKeys[number];
export type ImportMapping = Record<MappingKey, string>;
export type AmountFormat = "signed" | "split";
export const emptyMapping = (): ImportMapping => ({ date:"", description:"", amount:"", debit:"", credit:"", valueDate:"", balance:"", reference:"" });

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The statement response could not be confirmed. Please retry.");
  return value as Record<string, unknown>;
}
function count(value: unknown, maximum = 10000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new Error("The statement row count could not be confirmed.");
  return value as number;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new Error("The statement date range could not be confirmed.");
  return value;
}
export function mappingFields(mapping: ImportMapping, format: AmountFormat): Partial<Record<MappingKey, number>> {
  return Object.fromEntries(mappingKeys.filter(key => mapping[key] !== "" && (format === "signed" ? key !== "debit" && key !== "credit" : key !== "amount")).map(key => [key, Number(mapping[key])])) as Partial<Record<MappingKey, number>>;
}
export function validateMapping(mapping: ImportMapping, format: AmountFormat, columnCount: number): Partial<Record<MappingKey, string>> {
  const errors: Partial<Record<MappingKey, string>> = {};
  const used = new Map<number, MappingKey>();
  const required: MappingKey[] = ["date", "description", ...(format === "signed" ? ["amount" as const] : ["debit" as const, "credit" as const])];
  for (const key of mappingKeys) {
    if ((format === "signed" && (key === "debit" || key === "credit")) || (format === "split" && key === "amount")) continue;
    const value = mapping[key];
    if (value === "") { if (required.includes(key)) errors[key] = "Choose a column."; continue; }
    if (!/^\d+$/.test(value) || Number(value) >= columnCount) { errors[key] = "Choose a column from this file."; continue; }
    const prior = used.get(Number(value));
    if (prior) { errors[key] = "Each field must use a different column."; errors[prior] = "Each field must use a different column."; }
    used.set(Number(value), key);
  }
  return errors;
}
export function restoreMapping(value: string | null, columnCount: number): { mapping: ImportMapping; format: AmountFormat } | null {
  if (!value) return null;
  try {
    const raw = record(JSON.parse(value)); const mapping = emptyMapping();
    for (const key of mappingKeys) {
      if (raw[key] !== undefined && (typeof raw[key] !== "string" || !/^(?:\d+)?$/.test(raw[key] as string))) return null;
      mapping[key] = (raw[key] as string | undefined) ?? "";
    }
    const format = mapping.amount !== "" ? "signed" : "split";
    return Object.keys(validateMapping(mapping, format, columnCount)).length ? null : { mapping, format };
  } catch { return null; }
}
export function readInspection(value: unknown): { headers: string[]; sha256: string } {
  const raw = record(value);
  if (!Array.isArray(raw.headers) || !raw.headers.length || raw.headers.length > 80 || raw.headers.some(v => v !== null && !["string","number","boolean"].includes(typeof v)) || typeof raw.file_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.file_sha256)) throw new Error("The statement columns could not be confirmed. Read the file again.");
  return { headers: raw.headers.map(v => String(v ?? "")), sha256: raw.file_sha256 };
}
export type StatementPreview = { headers:string[]; preview:unknown[][]; row_count:number; valid_count:number; errors:{row_no:number;message:string}[]; file_sha256:string; repeated_fingerprint_groups:number; prior_fingerprint_groups:number; starts_on:string|null; ends_on:string|null };
export function readStatementPreview(value: unknown, expectedHash: string): StatementPreview {
  const raw = record(value); const inspected = readInspection(raw);
  if (inspected.sha256 !== expectedHash || !Array.isArray(raw.preview) || raw.preview.length > 6 || raw.preview.some(row => !Array.isArray(row) || row.some(cell => cell !== null && !["string","number","boolean"].includes(typeof cell))) || !Array.isArray(raw.errors)) throw new Error("The preview does not match the selected file. Read the file again.");
  const errors = raw.errors.map(value => { const row = record(value); if (typeof row.message !== "string" || (row.row_no as number) < 2) throw new Error("The row errors could not be confirmed."); return { row_no:count(row.row_no, 10001), message:row.message }; });
  const rows = count(raw.row_count); const valid = count(raw.valid_count);
  if (valid > rows || errors.length > rows - valid) throw new Error("The statement row counts do not agree.");
  const starts = date(raw.starts_on); const ends = date(raw.ends_on);
  if ((starts === null) !== (ends === null) || (valid > 0 && !starts) || (starts && ends && starts > ends)) throw new Error("The statement date range could not be confirmed.");
  return {headers:inspected.headers,preview:raw.preview as unknown[][],row_count:rows,valid_count:valid,errors,file_sha256:inspected.sha256,repeated_fingerprint_groups:count(raw.repeated_fingerprint_groups),prior_fingerprint_groups:count(raw.prior_fingerprint_groups),starts_on:starts,ends_on:ends};
}
export type ImportReceipt = { id:string; duplicate:boolean; row_count:number; review_count:number; cash_account_id:string; starts_on:string|null; ends_on:string|null };
export function readImportReceipt(value: unknown, accountId:string, expectedRows:number): ImportReceipt {
  const raw = record(value);
  if (typeof raw.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.id) || typeof raw.duplicate !== "boolean" || raw.cash_account_id !== accountId) throw new Error("The import result could not be confirmed. Retry the same import to check it safely.");
  const rows = count(raw.row_count);
  if (raw.duplicate ? rows !== 0 : rows !== expectedRows) throw new Error("The saved row count could not be confirmed. Retry the same import to check it safely.");
  const starts = date(raw.starts_on); const ends = date(raw.ends_on);
  if (raw.duplicate ? starts !== null || ends !== null : !starts || !ends || starts > ends) throw new Error("The saved statement dates could not be confirmed.");
  return { id:raw.id,duplicate:raw.duplicate,row_count:rows,review_count:count(raw.review_count ?? 0),cash_account_id:accountId,starts_on:starts,ends_on:ends };
}
export function importNextHref(organizationId:string, result:ImportReceipt): string {
  const query = new URLSearchParams({cash_account_id:result.cash_account_id});
  if (!result.duplicate && result.starts_on && result.ends_on) { query.set("starts_on",result.starts_on);query.set("ends_on",result.ends_on); }
  return `/o/${organizationId}/banking/reconciliations?${query}`;
}
