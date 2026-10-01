# Cookie-authenticated API origin validation

Role API mutations require an exact `Origin` matching the deployment's
`NEXT_PUBLIC_APP_URL`, plus the current organization/context nonce. Missing, opaque
or foreign origins are rejected. `Host`, `X-Forwarded-Host` and the framework's
internal Request URL cannot expand this allowlist. Set the correct app URL for
each local, preview and production deployment; missing/invalid configuration
fails closed. Non-browser callers using cookie authentication must also supply
the configured Origin and context nonce. No wildcard CORS is enabled.

This follows OWASP's configured target-origin approach for reverse proxies:
https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#identifying-the-target-origin

The browser suite performs API requests via same-origin browser `fetch`, rather
than APIRequestContext's different HTTP-loopback Secure-cookie behavior. A
positive authenticated API read precedes negative tests, preventing false denial
results from a missing session. `tests/application/mutation-origin.test.ts`
checks matching public origins despite internal hosts, foreign/missing/opaque
origins, misleading forwarded headers, scheme/port mismatches and invalid config.

This document describes the implemented contract; execution evidence is tracked
against the final PR commit, not inferred from test definitions.
