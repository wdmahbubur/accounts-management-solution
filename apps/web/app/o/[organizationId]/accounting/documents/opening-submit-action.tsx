"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function OpeningSubmitAction({ organizationId, documentId, version }: { organizationId: string; documentId: string; version: number }) {
  const router = useRouter(); const key = useRef(crypto.randomUUID()); const inFlight = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/submit`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": `opening-submit-${crypto.randomUUID()}`, "Idempotency-Key": key.current }, body: JSON.stringify({ expected_version: version }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.fields?.document ?? result?.error?.message ?? "The opening draft could not be submitted.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The submission could not be confirmed. Retry to check the same request."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="panel"><h2>Request opening approval</h2><p>Approval covers this exact draft version and its cutover evidence.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit for approval"}</button></section>;
}
