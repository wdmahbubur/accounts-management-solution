import { parseUuid, type Uuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export const accountTypes = ["asset", "liability", "equity", "income", "expense"] as const;
export const normalSides = ["debit", "credit"] as const;
export const controlKinds = ["ar", "ap", "customer_advance", "vendor_advance"] as const;
export const mappingKeys = ["cash", "bank", "ar", "vendor_advance", "input_tax", "ap", "output_tax", "customer_advance", "retained_earnings", "opening_suspense", "rounding_difference"] as const;
export type AccountType = typeof accountTypes[number];
export type NormalSide = typeof normalSides[number];
export type ControlKind = typeof controlKinds[number];
export type MappingKey = typeof mappingKeys[number];

export interface AccountRow {
  id: Uuid; code: string; name: string; parentId: Uuid | null; accountType: AccountType;
  normalSide: NormalSide; reportGroup: string; controlKind: ControlKind | null; isPostable: boolean;
  isActive: boolean; isSystem: boolean; rowVersion: number;
}
export interface AccountMapping { key: MappingKey; accountId: Uuid; rowVersion: number }
export interface AccountCatalog { accounts: AccountRow[]; mappings: AccountMapping[] }
export interface AccountInput {
  accountId: Uuid | null; expectedVersion: number | null; code: string; name: string; parentId: Uuid | null;
  accountType: AccountType; normalSide: NormalSide; reportGroup: string; controlKind: ControlKind | null;
  isPostable: boolean; isActive: boolean;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw CommandError.validation({ body: "Expected an object." });
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw CommandError.validation({ [field]: `Use 1-${max} characters.` });
  return value.trim();
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw CommandError.validation({ [field]: "Expected true or false." });
  return value;
}
function oneOf<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw CommandError.validation({ [field]: "Choose a supported value." });
  return value as T[number];
}
export function validateAccountInput(raw: unknown): AccountInput {
  const v=object(raw); const allowed=["account_id","expected_version","code","name","parent_id","account_type","normal_side","report_group","control_kind","is_postable","is_active"];
  if (Object.keys(v).some((k)=>!allowed.includes(k))) throw CommandError.validation({ body: "Unexpected request field." });
  const accountId=v.account_id===null?null:parseUuid(v.account_id,"account_id");
  const expectedVersion=v.expected_version===null?null:v.expected_version;
  if ((accountId===null && expectedVersion!==null)||(accountId!==null&&(!Number.isSafeInteger(expectedVersion)||Number(expectedVersion)<1))) throw CommandError.validation({ expected_version: "A current row version is required for edits." });
  const parentId=v.parent_id===null?null:parseUuid(v.parent_id,"parent_id");
  return {accountId,expectedVersion:expectedVersion as number|null,code:text(v.code,"code",32),name:text(v.name,"name",160),parentId,
    accountType:oneOf(v.account_type,accountTypes,"account_type"),normalSide:oneOf(v.normal_side,normalSides,"normal_side"),
    reportGroup:text(v.report_group,"report_group",80),controlKind:v.control_kind===null?null:oneOf(v.control_kind,controlKinds,"control_kind"),
    isPostable:bool(v.is_postable,"is_postable"),isActive:bool(v.is_active,"is_active")};
}
export function parseCatalog(value: unknown): AccountCatalog {
  if (!Array.isArray(value)) throw new Error("Invalid account catalog.");
  const accounts=new Map<string,AccountRow>(), mappings=new Map<string,AccountMapping>();
  for(const raw of value){ const r=object(raw); const id=parseUuid(r.id); const row={id,code:r.code,name:r.name,parentId:r.parent_id===null?null:parseUuid(r.parent_id),
    accountType:r.account_type,normalSide:r.normal_side,reportGroup:r.report_group,controlKind:r.control_kind,isPostable:r.is_postable,
    isActive:r.is_active,isSystem:r.is_system,rowVersion:r.row_version};
    if(typeof row.code!=="string"||typeof row.name!=="string"||typeof row.reportGroup!=="string"||!accountTypes.includes(row.accountType as AccountType)||
      !normalSides.includes(row.normalSide as NormalSide)||!(row.controlKind===null||controlKinds.includes(row.controlKind as ControlKind))||
      typeof row.isPostable!=="boolean"||typeof row.isActive!=="boolean"||typeof row.isSystem!=="boolean"||!Number.isSafeInteger(row.rowVersion)) throw new Error("Invalid account row.");
    accounts.set(id,row as AccountRow);
    if(r.mapping_key!==null){ const key=oneOf(r.mapping_key,mappingKeys,"mapping_key"); if(!Number.isSafeInteger(r.mapping_version)) throw new Error("Invalid mapping version."); mappings.set(key,{key,accountId:id,rowVersion:r.mapping_version as number}); }
  }
  return {accounts:[...accounts.values()],mappings:[...mappings.values()].sort((a,b)=>a.key.localeCompare(b.key))};
}
export function accountDatabaseError(error: {code?:string;message?:string}): CommandError {
  if(error.code==="28000")return CommandError.unauthenticated();
  if(error.code==="42501")return CommandError.forbidden();
  if(error.code==="P0002")return CommandError.notFound();
  if(error.code==="40001")return CommandError.conflict("STALE_VERSION");
  if(error.code==="22023"||error.code==="23514")return CommandError.validation({account:error.code==="23514"?"The account conflicts with chart, mapping, or history rules.":"Check the account fields."});
  if(error.code==="23505")return CommandError.validation({code:"That account code is already in use in this company."});
  return new CommandError({code:"INTERNAL_ERROR"});
}
