"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

export function ExportRequestForm({ organizationId, nonce }: { organizationId: string; nonce: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<{ key: string; request: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const request = JSON.stringify({ as_of: form.get("as_of"), from: form.get("from") || null, format: "csv" });
    if (!idempotencyKey.current || idempotencyKey.current.request !== request) idempotencyKey.current = { key: crypto.randomUUID(), request };
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/exports`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Company-Context": nonce,
          "Idempotency-Key": idempotencyKey.current.key },
        body: request
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || "The export could not be requested.");
      setMessage("Trial balance export queued. Refresh the job list to check its status.");
      formElement.reset(); idempotencyKey.current = null; router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The export could not be requested."); }
    finally { setBusy(false); }
  }
  return <form className="panel toolbar" onSubmit={submit}>
    <label>Movement from (optional)<input type="date" name="from" /></label>
    <label>Trial balance as of<input type="date" name="as_of" required defaultValue={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} /></label>
    <button type="submit" disabled={busy}>{busy ? "Queueing…" : "Request CSV export"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
