import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import nodemailer from "nodemailer";

export async function sendIdentityLink(email: string, purpose: "verify_email" | "reset_password" | "reauthenticate", token: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const target = new URL(purpose === "reset_password" ? "/auth/reset" : "/auth/verify", origin);
  target.searchParams.set("token", token);
  if (purpose !== "reset_password") target.searchParams.set("type", purpose);

  const subject = purpose === "verify_email" ? "Verify your Accounts Management account"
    : purpose === "reset_password" ? "Reset your Accounts Management password"
      : "Confirm your Accounts Management sign-in";
  const text = `Use this single-use link within its expiry period: ${target.toString()}`;
  const smtpUrl = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (smtpUrl && from) {
    const transport = nodemailer.createTransport(smtpUrl);
    await transport.sendMail({ from, to: email, subject, text });
    return;
  }

  if (process.env.NODE_ENV !== "development") throw new Error("Email delivery is not configured.");
  const outbox = join(process.cwd(), ".local-mail-preview");
  await mkdir(outbox, { recursive: true, mode: 0o700 });
  const filename = join(outbox, `${Date.now()}-${randomUUID()}.txt`);
  await writeFile(filename, `${subject}\nTo: ${email}\n\n${text}\n`, { mode: 0o600 });
}
