import { assertIsolatedTargets } from "./isolation.mjs";
import { processOutboxBatch } from "../../../apps/web/server/outbox/worker.ts";
assertIsolatedTargets(process.env.TEST_DATABASE_URL, process.env.DATABASE_RUNTIME_URL);
const smtp = new URL(process.env.SMTP_URL);
if (smtp.hostname !== "127.0.0.1") throw new Error("Worker acceptance may send only to its loopback SMTP fixture.");
const result = await processOutboxBatch(10);
process.send?.({ result });
process.disconnect?.();
