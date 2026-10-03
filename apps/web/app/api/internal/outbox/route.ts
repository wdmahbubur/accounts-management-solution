import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOutboxBatch, readOutboxDeadLetters } from "../../../../server/outbox/worker.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.OUTBOX_WORKER_SECRET;
  if (!expected || expected.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

function unavailable() {
  return NextResponse.json({ error: "worker_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!authorized(request)) return unavailable();
  try {
    const result = await processOutboxBatch(10);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "worker_failed" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return unavailable();
  try {
    const events = await readOutboxDeadLetters(50);
    return NextResponse.json({ data: events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "worker_failed" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
