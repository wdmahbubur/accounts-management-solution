"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { attachmentMimeExtensions } from "@ams/contracts";
import { attachmentIntent, attachmentMetadata, attachmentResult } from "./attachment-upload-model.ts";
import { useOnline } from "./components.tsx";

export function AttachmentUpload({ organizationId, documentId, nonce, canRead }: { organizationId: string; documentId: string; nonce: string; canRead: boolean }) {
  const id = useId(), online = useOnline(), input = useRef<HTMLInputElement>(null), errorArea = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false), [result, setResult] = useState<ReturnType<typeof attachmentResult> | null>(null);
  const inFlight = useRef(false), attempt = useRef<{ file: File; id: string; url: string } | null>(null);

  async function upload() {
    if (inFlight.current || !online || (!file && !attempt.current)) return;
    inFlight.current = true; setBusy(true); setError(""); setResult(null);
    try {
      if (!attempt.current) {
        const selected = file!;
        const metadata = await attachmentMetadata(selected);
        const response = await fetch(`/api/v1/organizations/${organizationId}/attachments/upload-intents`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Company-Context": nonce }, body: JSON.stringify({ document_id: documentId, ...metadata })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error?.message === "string" ? body.error.message : "The upload could not be started.");
        attempt.current = { file: selected, ...attachmentIntent(body.data, organizationId) };
      }
      const saved = attempt.current, form = new FormData(); form.set("file", saved.file);
      const response = await fetch(saved.url, { method: "POST", headers: { "X-Company-Context": nonce }, body: form });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && typeof body.error?.code === "string") attempt.current = null;
        const fields = body.error?.fields;
        const detail = fields && typeof fields.company === "string" ? fields.company : typeof body.error?.message === "string" ? body.error.message : "The upload could not be confirmed.";
        throw new Error(detail);
      }
      setResult(attachmentResult(body.data, saved.id));
      attempt.current = null; setFile(null); setUncertain(false);
      if (input.current) input.current.value = "";
    } catch (failure) {
      setUncertain(attempt.current !== null);
      setError(failure instanceof Error ? failure.message : "The upload could not be confirmed.");
      requestAnimationFrame(() => errorArea.current?.focus());
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Supporting files</h2>
    <form className="settings-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void upload(); }}>
      <label htmlFor={`${id}-file`}>Choose a supporting file
        <input id={`${id}-file`} ref={input} type="file" disabled={busy || uncertain} accept={Object.values(attachmentMimeExtensions).flat().map(extension => `.${extension}`).join(",")}
          aria-describedby={`${id}-hint`} onChange={event => { if (inFlight.current || attempt.current) return; setFile(event.target.files?.[0] ?? null); setError(""); setResult(null); }} />
        <small id={`${id}-hint`}>PDF, images, CSV or text · Up to 4 MB</small>
      </label>
      {error && <div ref={errorArea} role="alert" tabIndex={-1}>{error}</div>}
      {uncertain && <p role="status">The result is unconfirmed. Retry this file to check.</p>}
      <button type="submit" disabled={busy || !online || (!file && !uncertain)}>{busy ? "Uploading…" : uncertain ? "Retry this upload" : "Upload file"}</button>
      {!online && <p role="status">Reconnect to upload a file.</p>}
      {result && <p role="status">{result.status === "pending_scan" ? "Uploaded · Waiting for the security scan." : result.status === "rejected" ? "Rejected by security scan · Download unavailable." : "Security scan passed."}</p>}
      {result?.downloadable && canRead && <a href={`/api/v1/organizations/${organizationId}/attachments/${result.id}/download`} download>Download file</a>}
      {canRead && <Link href={`/o/${organizationId}/documents`}>Open evidence library</Link>}
    </form>
  </section>;
}
