"use client";
import { useState } from "react";
type Draft = { id: string; label: string };
export function EvidenceUploadForm({ organizationId, nonce, drafts }: { organizationId: string; nonce: string; drafts: Draft[] }) {
  const [message, setMessage] = useState(""); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(false); setBusy(true); setMessage("Preparing secure upload…");
    try {
      const form = new FormData(event.currentTarget); const file = form.get("file"); const documentId = form.get("document_id");
      if (!(file instanceof File) || typeof documentId !== "string") throw new Error("Choose a draft and a PDF, JPEG or PNG file.");
      const base = `/api/v1/organizations/${organizationId}/attachments`;
      const intentResponse = await fetch(`${base}/upload-intents`, { method: "POST", headers: {
        "Content-Type": "application/json", "x-company-context": nonce
      }, body: JSON.stringify({ document_id: documentId, filename: file.name, content_type: file.type,
        size: file.size }) });
      const intent = await intentResponse.json();
      if (!intentResponse.ok || typeof intent.data?.uploadPath !== "string") throw new Error(intent.error?.message ?? "Upload permission could not be created.");
      const bytes = new FormData(); bytes.set("file", file);
      const completeResponse = await fetch(intent.data.uploadPath, { method: "POST", headers: { "x-company-context": nonce }, body: bytes });
      const completed = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(completed.error?.message ?? "Upload could not be completed.");
      setMessage("Evidence received and quarantined. It remains unavailable until an approved scanner marks it clean.");
      event.currentTarget.reset();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "Upload could not be completed."); }
    finally { setBusy(false); }
  }
  if (!drafts.length) return <section className="panel"><h2>Add evidence</h2><p>No eligible draft documents are available to attach files to.</p></section>;
  return <section className="panel"><h2>Add evidence to a draft</h2>
    <form className="settings-form" onSubmit={submit}>
      <label className="field"><span>Draft document</span><select name="document_id" required defaultValue="">
        <option value="" disabled>Choose a draft document</option>{drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.label}</option>)}
      </select></label>
      <label className="field"><span>Evidence file (PDF, JPEG or PNG; up to 10 MiB)</span><input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
      <button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload evidence"}</button>
      {message && <p role={error ? "alert" : "status"} aria-live="polite">{message}</p>}
    </form>
  </section>;
}
