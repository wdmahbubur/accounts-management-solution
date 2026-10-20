import "server-only";

import { CommandError } from "../commands/errors.ts";

export function isEmailTransportAvailable(): boolean {
  return process.env.NODE_ENV === "development" ||
    Boolean(process.env.SMTP_URL?.trim() && process.env.SMTP_FROM?.trim());
}

export function requireInvoiceEmailDelivery(): void {
  if (process.env.NODE_ENV === "development") return;
  if (!isEmailTransportAvailable() || !process.env.DATABASE_WORKER_URL?.trim() ||
      (process.env.OUTBOX_WORKER_SECRET?.length ?? 0) < 32) {
    throw new CommandError({ code: "INTERNAL_ERROR", status: 503,
      message: "Invoice email delivery is temporarily unavailable. Try again later." });
  }
}
