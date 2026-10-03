import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { decryptInvitationDelivery } from "../invitations/tokens.ts";
import { withWorkerDatabase } from "../database.ts";
import { readPrivateObject } from "../storage/private.ts";

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

type ClaimedInvoiceDelivery = {
  organization_id: string; document_id: string; recipient: string; pdf_version_id: string;
  object_key: string; download_filename: string; sha256: string; byte_size: string | number;
  source_document_version: number; source_material_digest: string;
};

async function deliverInvoice(event: ClaimedEvent): Promise<string | null> {
  const result = await withWorkerDatabase(client => client.query<ClaimedInvoiceDelivery>(
    "SELECT * FROM finance_private.read_claimed_invoice_delivery($1::uuid,$2::uuid)",
    [event.event_id, event.lease_token]
  ));
  const invoice = result.rows[0];
  if (!invoice || invoice.organization_id !== event.organization_id ||
      !/^[0-9a-f-]{36}$/i.test(invoice.document_id) || !/^[0-9a-f-]{36}$/i.test(invoice.pdf_version_id) ||
      invoice.object_key !== `${invoice.organization_id}/invoice-pdfs/${invoice.pdf_version_id}` ||
      invoice.download_filename !== `invoice-${invoice.pdf_version_id}.pdf` ||
      !/^[0-9a-f]{64}$/.test(invoice.sha256) || !/^[0-9a-f]{64}$/.test(invoice.source_material_digest) ||
      !Number.isSafeInteger(Number(invoice.byte_size)) || Number(invoice.byte_size) < 1 || Number(invoice.byte_size) > 10 * 1024 * 1024 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.recipient) ||
      event.payload.pdf_version_id !== invoice.pdf_version_id ||
      event.payload.source_document_version !== invoice.source_document_version ||
      event.payload.source_material_digest !== invoice.source_material_digest) {
    throw Object.assign(new Error("Unavailable invoice delivery"), { safeCode: "INVOICE_NOT_DELIVERABLE" });
  }
  const bytes = await readPrivateObject(invoice.object_key);
  if (!bytes || bytes.byteLength !== Number(invoice.byte_size) ||
      createHash("sha256").update(bytes).digest("hex") !== invoice.sha256 ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw Object.assign(new Error("Invoice PDF unavailable"), { safeCode: "INVOICE_PDF_UNAVAILABLE" });
  }
  const smtpUrl = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (!smtpUrl || !from) {
    if (process.env.NODE_ENV !== "development") throw Object.assign(new Error("SMTP is not configured"), { safeCode: "SMTP_NOT_CONFIGURED" });
    const directory = join(process.cwd(), ".local-mail-preview");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `invoice-${event.event_id}-${randomUUID()}.eml`),
      `To: ${invoice.recipient}\nSubject: Your issued invoice is attached\n\nThe issued invoice PDF is attached to this email.\nAttachment: ${invoice.download_filename}\nBytes: ${bytes.byteLength}\n`,
      { mode: 0o600, flag: "wx" });
    return `local-preview-${event.event_id}`;
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const transport = nodemailer.createTransport(smtpUrl);
  try {
    const receipt = await transport.sendMail({
      from, to: invoice.recipient, subject: "Your issued invoice is attached",
      text: "Please find the issued invoice attached.",
      attachments: [{ filename: invoice.download_filename, content: Buffer.from(bytes), contentType: "application/pdf" }],
      messageId: `<ams-outbox-${event.event_id}@${new URL(origin).hostname}>`
    });
    return receipt.messageId ?? null;
  } finally { transport.close(); }
}

type ClaimedReminder = {
  event_id: string; organization_id: string; organization_name: string; category: string;
  scheduled_date: string; recipient: string;
};

async function deliverReminder(event: ClaimedEvent): Promise<string | null> {
  const result = await withWorkerDatabase(client => client.query<ClaimedReminder>(
    "SELECT * FROM finance_private.read_claimed_financial_reminder($1::uuid,$2::uuid)",
    [event.event_id, event.lease_token]
  ));
  const reminder = result.rows[0];
  // If the reminder stopped being actionable, complete the stale queue item without sending.
  if (!reminder) return null;
  const destinations: Record<string, string> = {
    approval: "/approvals",
    invoice_due: "/sales/invoices",
    bill_due: "/purchases/bills"
  };
  const route = destinations[reminder.category];
  if (reminder.event_id !== event.event_id || reminder.organization_id !== event.organization_id || !route ||
      !/^\d{4}-\d{2}-\d{2}$/.test(reminder.scheduled_date) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reminder.recipient) ||
      event.payload.member_id === undefined || event.payload.category !== reminder.category ||
      event.payload.scheduled_date !== reminder.scheduled_date) {
    throw Object.assign(new Error("Unavailable financial reminder"), { safeCode: "REMINDER_NOT_DELIVERABLE" });
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = new URL(`/o/${encodeURIComponent(event.organization_id)}${route}`, origin).toString();
  const subjects: Record<string, string> = {
    approval: "A company approval needs your attention",
    invoice_due: "A customer invoice needs your attention",
    bill_due: "A supplier bill needs your attention"
  };
  const subject = subjects[reminder.category]!;
  const text = `There is an item to review in your company workspace. Sign in to see the current details: ${link}`;
  const smtpUrl = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (smtpUrl && from) {
    const transport = nodemailer.createTransport(smtpUrl);
    try {
      const receipt = await transport.sendMail({
        from, to: reminder.recipient, subject, text,
        messageId: `<ams-outbox-${event.event_id}@${new URL(origin).hostname}>`
      });
      return receipt.messageId ?? null;
    } finally { transport.close(); }
  }
  if (process.env.NODE_ENV !== "development") throw Object.assign(new Error("SMTP is not configured"), { safeCode: "SMTP_NOT_CONFIGURED" });
  const directory = join(process.cwd(), ".local-mail-preview");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `reminder-${event.event_id}-${randomUUID()}.txt`),
    `${subject}\nTo: ${reminder.recipient}\n\n${text}\n`, { mode: 0o600, flag: "wx" });
  return `local-preview-${event.event_id}`;
}

export async function processOutboxBatch(limit = 10) {
  const batchLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 10;
  const claimed = await withWorkerDatabase(async client => client.query<ClaimedEvent>(
    "SELECT * FROM finance_private.claim_outbox_batch($1::text[], $2::integer, $3::integer)",
    [["invitation.send", "document.send_requested", "financial.reminder"], batchLimit, 120]
  ));
  const outcomes = await Promise.all(claimed.rows.map(async event => {
    try {
      const messageId = event.event_type === "invitation.send" ? await deliverInvitation(event) :
        event.event_type === "document.send_requested" ? await deliverInvoice(event) :
        event.event_type === "financial.reminder" ? await deliverReminder(event) :
          (() => { throw Object.assign(new Error("Unsupported event"), { safeCode: "UNSUPPORTED_EVENT_TYPE" }); })();
      await withWorkerDatabase(client => client.query(
        "SELECT finance_private.complete_outbox_delivery($1::uuid,$2::uuid,$3::text)",
        [event.event_id, event.lease_token, messageId]
      ));
      return "sent" as const;
    } catch (error) {
      const safeCode = (error as { safeCode?: unknown }).safeCode;
      const errorCode = typeof safeCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(safeCode)
        ? safeCode : "EMAIL_DELIVERY_FAILED";
      try {
        await withWorkerDatabase(client => client.query(
          "SELECT finance_private.fail_outbox_delivery($1::uuid,$2::uuid,$3::text)",
          [event.event_id, event.lease_token, errorCode]
        ));
        return "retried" as const;
      } catch {
        // A reclaimed or expired lease belongs to another worker; never overwrite its result.
        return "lease_lost" as const;
      }
    }
  }));
  return { claimed: claimed.rowCount ?? claimed.rows.length,
    sent: outcomes.filter(outcome => outcome === "sent").length,
    retried: outcomes.filter(outcome => outcome === "retried").length };
}

export async function readOutboxDeadLetters(limit = 50) {
  const result = await withWorkerDatabase(client => client.query(
    "SELECT * FROM finance_private.read_outbox_dead_letters($1::integer)", [limit]
  ));
  return result.rows;
}
