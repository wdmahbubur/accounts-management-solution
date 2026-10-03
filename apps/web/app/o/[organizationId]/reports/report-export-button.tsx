"use client";

import { useState } from "react";
import Link from "next/link";

export function ReportExportButton({ organizationId, exportType, filters }: {
  organizationId: string; exportType: "profit_and_loss" | "balance_sheet" | "customer_statement" | "vendor_statement";
  filters: Record<string, string>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"csv" | "pdf" | "xlsx">("csv");
  async function requestExport() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/exports`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ export_type: exportType, format, ...filters })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "Export could not be queued.");
      setMessage(`${format.toUpperCase()} export queued.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export could not be queued.");
    } finally { setBusy(false); }
  }
  return <span><label>File format <select value={format} onChange={(event) => setFormat(event.target.value as "csv" | "pdf" | "xlsx")} disabled={busy}><option value="csv">CSV</option><option value="pdf">PDF</option><option value="xlsx">XLSX</option></select></label> <button type="button" className="secondary" disabled={busy} onClick={requestExport}>{busy ? "Queuing…" : "Queue export"}</button>{message&&<span role="status"> {message} <Link href={`/o/${organizationId}/exports`}>Export jobs</Link></span>}</span>;
}
