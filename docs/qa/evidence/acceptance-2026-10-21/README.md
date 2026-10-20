# Retained acceptance execution output

See [scope, exact commands, source-case traceability and limits](../../full-acceptance-2026-10-21.md).

- `accounting-aggregate.log`: 53 actual database/application-command tests, including genuine connection races and process-death replay.
- `final-exports-and-snapshot.log`: 7 actual provider/application file checks after dependency updates on the final clean target.
- `final-authenticated-http.log`: 5 actual local HTTP/session checks on Next 16.4.2. No browser/UI coverage is inferred.
- `worker-recovery.log`: 4 actual renderer/private-object/loopback-SMTP/worker-lease checks. No external email was sent.
- `refund-and-cash.log`: 16 grouped cash posting checks plus the refund-denial test. `refund-unsafe-baseline.log` deliberately records the earlier failed safety expectation.
- `legacy-*`: other isolated regression suites; identity/master/role fixtures are disclosed in the tests and report.
- `migration-clean-install.log` / `migration-upgrade.log`: clean installation followed by forward upgrades, including both LF and historical CRLF function bodies; 105 files through 0106.
- `pre-dependency-update-*`: earlier positive evidence retained separately; final retests supersede it for dependency-sensitive behavior.
- `final-*` quality/audit output and `lockfile-reinstall.log`: reproducible pinned install, build, lint/type/application checks and both audit scopes. Five high dev-only propagated lint findings remain; production audit has zero findings.

Application/test code: `517aacf317ae255e1fa970859b4b5be2b3b16d95`; final dependency/migration compatibility: `f90d5fd627e5b54c7997ca29c3f61d67ae7b705c`. Documentation-only commits can follow these code revisions. Private database/SMTP/storage credentials, exact profiles, manifests and object bytes remain under ignored local `output/` and are excluded here. Evidence files were checked against those private configuration values before copying.
