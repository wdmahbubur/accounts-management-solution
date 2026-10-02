import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboxEvent = {
  id: string;
  organization_id: string;
  event_type: string;
  document_id: string | null;
  deduplication_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_until: string;
};
export type OutboxHandler = (input: { event: OutboxEvent; idempotencyKey: string }) => Promise<void>;

export class OutboxDeliveryError extends Error {
  constructor(readonly code: string, readonly retryable = true) {
    super("Outbox handler failed.");
    this.name = "OutboxDeliveryError";
  }
}

type WorkerClient = Pick<SupabaseClient, "rpc">;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

/** Uses only the organization-scoped worker RPCs; never reads or mutates ledger tables. */
export async function processOutboxBatch(input: {
  client: WorkerClient;
  organizationId: string;
  workerId: string;
  handlers: Readonly<Record<string, OutboxHandler>>;
  limit?: number;
  leaseSeconds?: number;
}) {
  const claimed = await input.client.rpc("claim_outbox_events", {
    p_organization_id: input.organizationId, p_worker_id: input.workerId,
    p_limit: input.limit ?? 20, p_lease_seconds: input.leaseSeconds ?? 300
  });
  if (claimed.error || !Array.isArray(claimed.data)) throw new Error("Outbox claim failed.");
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const event of claimed.data as OutboxEvent[]) {
    const handler = input.handlers[event.event_type];
    try {
      if (!handler) throw new OutboxDeliveryError("HANDLER_NOT_REGISTERED", false);
      await handler({ event, idempotencyKey: event.deduplication_key });
    } catch (error) {
      const code = error instanceof OutboxDeliveryError && SAFE_CODE.test(error.code) ? error.code : "HANDLER_FAILED";
      const retryable = error instanceof OutboxDeliveryError ? error.retryable : true;
      const failed = await input.client.rpc("fail_outbox_event", {
        p_organization_id: input.organizationId, p_event_id: event.id, p_worker_id: input.workerId,
        p_error_code: code, p_retryable: retryable
      });
      if (failed.error) throw new Error("Outbox failure state could not be recorded.");
      const result = (failed.data as { status?: unknown }[] | null)?.[0];
      if (result?.status === "failed") deadLettered++;
      else retried++;
      continue;
    }
    const acknowledged = await input.client.rpc("ack_outbox_event", {
      p_organization_id: input.organizationId, p_event_id: event.id, p_worker_id: input.workerId
    });
    if (acknowledged.error || acknowledged.data !== true) throw new Error("Outbox acknowledgement failed; lease recovery will retry the event.");
    delivered++;
  }
  return { claimed: claimed.data.length, delivered, retried, deadLettered };
}
