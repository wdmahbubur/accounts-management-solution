import { parseUuid, type Uuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
export type InvitationOperation = "create" | "resend" | "revoke";
export interface InvitationInput { email?: string; roleId?: Uuid; invitationId?: Uuid }
export interface InvitationReceipt { message: string; invitationId: Uuid; invitationPath?: string }
export interface RecipientReceipt { message: string; organizationId: Uuid; status: "accepted" | "rejected" }
export interface InvitationRow {
  id: Uuid; email: string; roleId: Uuid; roleName: string;
  status: "pending" | "accepted" | "rejected" | "expired" | "revoked";
  expiresAt: string; generation: number;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw CommandError.validation({ body: "Unexpected request field." });
}
export function invitationToken(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw CommandError.notFound();
  return raw;
}
export function invitationInput(operation: InvitationOperation, raw: unknown): InvitationInput {
  const value = record(raw);
  if (operation !== "create") { only(value, ["invitation_id"]); return { invitationId: parseUuid(value.invitation_id) }; }
  only(value, ["email", "role_id"]);
  if (typeof value.email !== "string" || value.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) {
    throw CommandError.validation({ email: "Enter a valid recipient email address." });
  }
  return { email: value.email.trim().toLowerCase(), roleId: parseUuid(value.role_id, "role_id") };
}
export function recipientInput(raw: unknown): { token: string; decision: "accept" | "reject" } {
  const value = record(raw); only(value, ["token", "decision"]);
  if (value.decision !== "accept" && value.decision !== "reject") throw CommandError.validation({ decision: "Accept or reject the invitation." });
  return { token: invitationToken(value.token), decision: value.decision };
}
export function invitationRows(raw: unknown): InvitationRow[] {
  if (!Array.isArray(raw)) throw new Error("Invalid invitations response.");
  return raw.map((item) => {
    const v = record(item);
    if (typeof v.email !== "string" || typeof v.role_name !== "string" ||
      !["pending", "accepted", "rejected", "expired", "revoked"].includes(String(v.invitation_status)) ||
      typeof v.expires_at !== "string" || !Number.isFinite(Date.parse(v.expires_at)) || !Number.isSafeInteger(v.generation)) {
      throw new Error("Invalid invitation row.");
    }
    return { id: parseUuid(v.invitation_id), email: v.email, roleId: parseUuid(v.role_id), roleName: v.role_name,
      status: v.invitation_status as InvitationRow["status"], expiresAt: v.expires_at, generation: v.generation as number };
  });
}
