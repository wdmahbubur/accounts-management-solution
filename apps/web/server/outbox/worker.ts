import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { decryptInvitationDelivery } from "../invitations/tokens.ts";
import { withDatabase } from "../database.ts";

type ClaimedEvent = {
  event_id: string;
  organization_id: string;
  organization_name: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
  recipient: string | null;
  invitation_role: string | null;
  token_hash: string | null;
};

function html(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function deliverInvitation(event: ClaimedEvent): Promise<string | null> {
  const invitationId = typeof event.payload.invitation_id === "string" ? event.payload.invitation_id : "";
  const envelope = event.payload.delivery;
  if (!event.recipient || !event.token_hash || !invitationId || !envelope || typeof envelope !== "object") {
    throw Object.assign(new Error("Unavailable invitation"), { safeCode: "INVITATION_NOT_DELIVERABLE" });
  }
  const token = decryptInvitationDelivery(event.organization_id, invitationId, event.token_hash,
    envelope as { version: 1; iv: string; ciphertext: string; tag: string });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = new URL(`/invite/${encodeURIComponent(token)}`, origin).toString();
  const company = event.organization_name;
  const role = event.invitation_role ?? "assigned";
  const subject = `You are invited to ${company}`;
  const text = `You have been invited to join ${company} as ${role}. Accept the invitation within 72 hours: ${link}`;
  const smtpUrl = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (smtpUrl && from) {
    const transport = nodemailer.createTransport(smtpUrl);
    try {
      const receipt = await transport.sendMail({
        from, to: event.recipient, subject, text,
        html: `<p>You have been invited to join <strong>${html(company)}</strong> as ${html(role)}.</p><p><a href="${html(link)}">Accept the invitation</a></p><p>This link expires in 72 hours.</p>`,
        messageId: `<ams-outbox-${event.event_id}@${new URL(origin).hostname}>`
      });
      return receipt.messageId ?? null;
    } finally { transport.close(); }
  }
  if (process.env.NODE_ENV !== "development") throw Object.assign(new Error("SMTP is not configured"), { safeCode: "SMTP_NOT_CONFIGURED" });
  const directory = join(process.cwd(), ".local-mail-preview");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `invitation-${event.event_id}-${randomUUID()}.txt`),
    `${subject}\nTo: ${event.recipient}\n\n${text}\n`, { mode: 0o600, flag: "wx" });
  return `local-preview-${event.event_id}`;
}

export async function processOutboxBatch(limit = 10) {
  const claimed = await withDatabase(async client => client.query<ClaimedEvent>(
    "SELECT * FROM finance_private.claim_outbox_batch($1::text[], $2::integer, $3::integer)",
    [["invitation.send"], limit, 120]
  ));
  let sent = 0;
  let retried = 0;
  for (const event of claimed.rows) {
    try {
      if (event.event_type !== "invitation.send") throw Object.assign(new Error("Unsupported event"), { safeCode: "UNSUPPORTED_EVENT_TYPE" });
      const messageId = await deliverInvitation(event);
      await withDatabase(client => client.query(
        "SELECT finance_private.complete_outbox_delivery($1::uuid,$2::uuid,$3::text)",
        [event.event_id, event.lease_token, messageId]
      ));
      sent++;
    } catch (error) {
      const safeCode = (error as { safeCode?: unknown }).safeCode;
      const errorCode = typeof safeCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(safeCode)
        ? safeCode : "EMAIL_DELIVERY_FAILED";
      try {
        await withDatabase(client => client.query(
          "SELECT finance_private.fail_outbox_delivery($1::uuid,$2::uuid,$3::text)",
          [event.event_id, event.lease_token, errorCode]
        ));
        retried++;
      } catch {
        // A reclaimed or expired lease belongs to another worker; never overwrite its result.
      }
    }
  }
  return { claimed: claimed.rowCount ?? claimed.rows.length, sent, retried };
}

export async function readOutboxDeadLetters(limit = 50) {
  const result = await withDatabase(client => client.query(
    "SELECT * FROM finance_private.read_outbox_dead_letters($1::integer)", [limit]
  ));
  return result.rows;
}
