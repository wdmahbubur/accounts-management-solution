import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processTrialBalanceExportBatch } from "../../../../server/exports/worker.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.EXPORT_WORKER_SECRET;
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "worker_unavailable" }, { status: 503,
    headers: { "Cache-Control": "private, no-store" } });
  try {
    const result = await processTrialBalanceExportBatch(3);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "worker_failed" }, { status: 503,
      headers: { "Cache-Control": "private, no-store" } });
  }
}
