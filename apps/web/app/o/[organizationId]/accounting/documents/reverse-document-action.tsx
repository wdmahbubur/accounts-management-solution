"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseUuid } from "@ams/contracts";
import {
  documentActionError, isConfirmedFormRejection, RecoverableFormRequest,
  reversalDefaultDate, reversalFieldErrors
} from "./document-action-validation.ts";

export function ReverseDocumentAction({ organizationId, documentId, sourceDate, defaultDate }: {
  organizationId: string; documentId: string; sourceDate: string; defaultDate?: string;
}) {
  const router = useRouter();
  const id = useId();
  const request = useRef(new RecoverableFormRequest());
  const errorRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(() => reversalDefaultDate(sourceDate, defaultDate));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  function focusError() { requestAnimationFrame(() => errorRef.current?.focus()); }

  async function reverse() {
    if (busy || confirmed) return;
    const errors = reversalFieldErrors({ date, sourceDate, reason });
    if (Object.keys(errors).length) {
      setFields(errors); setError("Check the reversal date and correction reason."); focusError(); return;
    }
    const attempt = request.current.begin(JSON.stringify({ reversal_date: date, reason: reason.trim() }));
    if (!attempt) return;
    setBusy(true); setError(""); setFields({});
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/documents/${documentId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": `document-reverse-${crypto.randomUUID()}`, "Idempotency-Key": attempt.key },
        body: attempt.body
      });
      const body = await response.json();
      if (!response.ok) {
        if (isConfirmedFormRejection(response.status, body)) request.current.rejected();
        const failure = documentActionError(body, "The document could not be reversed.");
        setFields(failure.fields);
        throw new Error(failure.message);
      }
      const reversalId = parseUuid(body.data?.reversalDocumentId);
      if (body.data?.state !== "posted" || body.data?.reversalDate !== date || reversalId === documentId) {
        throw new Error("The reversal result could not be confirmed.");
      }
      request.current.confirmed(); setRetry(false); setConfirmed(true);
      router.push(`/o/${organizationId}/accounting/documents/${reversalId}`);
      router.refresh();
    } catch (failure) {
      request.current.uncertain(); setRetry(request.current.needsRetry);
      setError(failure instanceof Error ? failure.message : "The reversal result could not be confirmed."); focusError();
    } finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Reverse this document</h2>
    <p>Use a reversal to cancel the accounting effect of this posted document. The original stays in the history, with a linked reversal and dated settlement corrections.</p>
    <p>The reversal date must be in an open period. If a related bank reconciliation is finalized, reopen it first.</p>
    <form className="settings-form" aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      if (event.currentTarget.reportValidity()) void reverse();
    }}>
      {error && <div ref={errorRef} tabIndex={-1} role="alert">
        <strong>{error}</strong>
        {Object.keys(fields).length > 0 && <ul>{Object.entries(fields).map(([field, message]) => <li key={field}>{message}</li>)}</ul>}
      </div>}
      {retry && <p role="status">The result is unconfirmed. Your date and reason are kept unchanged. Retry to confirm the same reversal before making another correction.</p>}
      <fieldset disabled={busy || retry || confirmed} style={{ display: "grid", gap: "1rem", border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label htmlFor={`${id}-date`}>Reversal date
          <input id={`${id}-date`} name="reversal_date" type="date" min={sourceDate} required value={date}
            aria-invalid={Boolean(fields.reversal_date)} aria-describedby={`${id}-date-hint`}
            onChange={event => { setDate(event.target.value); setFields({}); }} />
          <small id={`${id}-date-hint`}>Choose {sourceDate} or a later date. The default follows Bangladesh time.</small>
        </label>
        <label htmlFor={`${id}-reason`}>Why are you reversing it?
          <textarea id={`${id}-reason`} name="reason" minLength={10} maxLength={800} rows={3} required value={reason}
            aria-invalid={Boolean(fields.reason)} aria-describedby={`${id}-reason-hint`}
            onChange={event => { setReason(event.target.value); setFields({}); }} />
          <small id={`${id}-reason-hint`}>Explain the correction in 10–800 characters. This reason stays in the document history.</small>
        </label>
      </fieldset>
      <button type="submit" disabled={busy || confirmed}>{busy ? "Posting reversal…" : retry ? "Retry the same reversal" : confirmed ? "Reversal posted" : "Post reversal"}</button>
      {busy && <p role="status">Posting the reversal. Keep this page open until the result is confirmed.</p>}
    </form>
  </section>;
}
