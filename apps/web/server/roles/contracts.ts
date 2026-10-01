import { parseUuid, type Uuid } from "@ams/contracts";
import { capabilityCodes, type CapabilityCode } from "@ams/permissions";
import { CommandError } from "../commands/errors.ts";

export interface ManagedRole {
  id: Uuid; name: string; templateKey: string | null;
  isSystem: boolean; permissionCodes: CapabilityCode[];
}
export interface ManagedMember {
  id: Uuid; displayName: string; status: "active" | "inactive";
  roleIds: Uuid[]; roleNames: string[]; isOwner: boolean;
}
export interface RoleReceipt { message: string; roleId?: string }
export type RoleOperation = "create" | "update" | "assign" | "deactivate" | "transfer";
export interface RoleInput {
  name?: string; permissionCodes?: CapabilityCode[];
  roleId?: Uuid; memberId?: Uuid; roleIds?: Uuid[];
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw CommandError.validation({ body: "Expected an object." });
  }
  return value as Record<string, unknown>;
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw CommandError.validation({ [field]: "Expected a list of strings." });
  }
  return value;
}
export function permissionList(value: unknown): CapabilityCode[] {
  const codes = strings(value, "permission_codes");
  if (codes.length > capabilityCodes.length || codes.some((code) =>
    !(capabilityCodes as readonly string[]).includes(code))) {
    throw CommandError.validation({ permission_codes: "Select documented capabilities only." });
  }
  return [...new Set(codes)].sort() as CapabilityCode[];
}
export function validateRoleInput(operation: RoleOperation, raw: unknown): RoleInput {
  const value = record(raw);
  const allowed = operation === "create" ? ["name", "permission_codes"]
    : operation === "update" ? ["role_id", "name", "permission_codes"]
    : operation === "assign" ? ["member_id", "role_ids"] : ["member_id"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw CommandError.validation({ body: "Unexpected request field." });
  }
  if (operation === "create" || operation === "update") {
    if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120) {
      throw CommandError.validation({ name: "Use a role name of 1–120 characters." });
    }
    return { name: value.name.trim(), permissionCodes: permissionList(value.permission_codes),
      ...(operation === "update" ? { roleId: parseUuid(value.role_id, "role_id") } : {}) };
  }
  const memberId = parseUuid(value.member_id, "member_id");
  if (operation !== "assign") return { memberId };
  const ids = strings(value.role_ids, "role_ids");
  if (ids.length > 64) throw CommandError.validation({ role_ids: "Select at most 64 roles." });
  return { memberId, roleIds: [...new Set(ids.map((id) => parseUuid(id, "role_ids")))].sort() };
}
export function parseRoles(value: unknown): ManagedRole[] {
  if (!Array.isArray(value)) throw new Error("Invalid role response.");
  return value.map((raw) => {
    const row = record(raw);
    if (typeof row.role_name !== "string" || typeof row.is_system !== "boolean" ||
      !(row.template_key === null || typeof row.template_key === "string")) throw new Error("Invalid role row.");
    return { id: parseUuid(row.role_id), name: row.role_name,
      isSystem: row.is_system, templateKey: row.template_key,
      permissionCodes: permissionList(row.permission_codes) };
  });
}
export function parseMembers(value: unknown): ManagedMember[] {
  if (!Array.isArray(value)) throw new Error("Invalid member response.");
  return value.map((raw) => {
    const row = record(raw);
    if (typeof row.display_name !== "string" || typeof row.is_owner !== "boolean" ||
      (row.member_status !== "active" && row.member_status !== "inactive")) throw new Error("Invalid member row.");
    return { id: parseUuid(row.member_id), displayName: row.display_name,
      status: row.member_status, isOwner: row.is_owner,
      roleIds: strings(row.role_ids, "role_ids").map((id) => parseUuid(id)),
      roleNames: strings(row.role_names, "role_names") };
  });
}
