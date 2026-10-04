"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function InvoiceSendAction({ organizationId, documentId }: { organizationId: string; documentId: string }) {
  const router = useRouter();
  const requestKey = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/send`, {
        method: "POST",
        headers: { "X-Request-Id": `invoice-email-${crypto.randomUUID()}`, "Idempotency-Key": requestKey.current }
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.fields?.invoice ?? body?.error?.message ?? "Invoice email could not be queued.");
      requestKey.current = crypto.randomUUID();
      setNotice(body?.data?.status === "sent" || body?.data?.status === "delivered"
        ? "This request was already delivered. Use Send / resend invoice email to create a new delivery attempt."
        : "Invoice email request recorded. Delivery status will update here after the worker runs.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invoice email could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button type="button" className="secondary" onClick={send} disabled={busy}>{busy ? "Queuing…" : "Send / resend invoice email"}</button>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
