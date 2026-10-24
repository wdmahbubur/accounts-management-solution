"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import styles from "./report.module.css";
import { RecoverableFormRequest, isConfirmedFormRejection } from '../accounting/documents/document-action-validation.ts';

export function ReportExportButton({ organizationId, exportType, filters, snapshotId }: {
  organizationId: string; exportType: "trial_balance" | "profit_and_loss" | "balance_sheet" | "customer_statement" | "vendor_statement";
  filters: Record<string, string>; snapshotId: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const attempt = useRef(new RecoverableFormRequest());
  const pending = useRef(false);
  const [format, setFormat] = useState<"csv" | "pdf" | "xlsx">("csv");
  async function requestExport() {
    if (pending.current) return;
    const body = exportType === "trial_balance"
      ? { ...filters, snapshot_id: snapshotId }
      : { export_type: exportType, format, snapshot_id: snapshotId, ...filters };
    const next = attempt.current.begin(JSON.stringify(body));
    if (!next) return;
    pending.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/exports`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": next.key },
        body: next.body
      });
      const result = await response.json();
      if (!response.ok) {
        if (isConfirmedFormRejection(response.status,result)) attempt.current.rejected();
        throw new Error(result?.error?.message ?? "Export could not be queued.");
      }
      if (typeof result.data?.id !== 'string') throw new Error('Export confirmation is incomplete. Retry the same request.');
      attempt.current.confirmed(); setRetry(false);
      setMessage(`${format.toUpperCase()} export queued.`);
    } catch (error) {
      attempt.current.uncertain(); setRetry(attempt.current.needsRetry);
      setMessage(error instanceof Error ? error.message : "Export could not be queued.");
    } finally { pending.current=false; setBusy(false); }
  }
  return <span className={styles.exportControls}>{exportType !== "trial_balance"&&<><label>File format <select value={format} onChange={(event) => setFormat(event.target.value as "csv" | "pdf" | "xlsx")} disabled={busy||retry}><option value="csv">CSV</option><option value="pdf">PDF</option><option value="xlsx">XLSX</option></select></label> </>}<button type="button" className="secondary" disabled={busy} onClick={requestExport}>{busy ? "Queuing…" : retry ? "Retry export" : "Queue export"}</button>{message&&<span role="status"> {message} <Link href={`/o/${organizationId}/exports`}>Export jobs</Link></span>}</span>;
}
