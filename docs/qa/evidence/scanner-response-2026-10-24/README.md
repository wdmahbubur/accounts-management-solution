# Scanner response receipts

Source `8a30c2e65ce6acd84efb01c39b86ea6eed0adde7`. [Full report and exact commands](../../scanner-response-lifecycle-2026-10-24.md).

- `real-before.log`: **3 passed / 2 failed**, including the parent failure. A clean file remained quarantined after a protocol error; this is not a successful run.
- `delayed-before.json`, `delayed-after.json`, `delayed-probe.mjs.txt`: deterministic asynchronous-response reproduction and the exact harmless loopback probe.
- `real-after.log`: **5/5 passed**, no skips; actual private-store uploads, ClamAV/EICAR, authorization and outage behavior with final client code.
- `application.log`: **356/356 passed**, including six scanner adapter tests and the 20-second trickle deadline. No skips.
- `typecheck.log`, `lint.log`: passed.
- `signatures.log`: actual freshclam update to daily revision 28162; the daemon remains loopback-only.

These checks do not include a production worker deployment or a completed Edge file upload; the absent saved-draft upload control is recorded as follow-up work. No credentials, private object bytes, real customer data or clean-verdict override are published.
