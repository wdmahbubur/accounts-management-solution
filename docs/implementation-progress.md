# Implementation progress

## US-049 — bank statement import

Implemented in the application on 3 October 2026. The organization-scoped wizard supports UTF-8 CSV and single-sheet XLSX files, maps transaction date and description plus either signed amount or debit/credit, and optionally maps value date, balance and bank reference. It saves mappings on the current device, previews sample rows, reports row validation errors, warns on repeated and prior fingerprints before confirmation, keeps exact raw row values, and rejects formula cells and unsupported or oversized files.

The confirm command checks the live `banking.write` capability and active cash account in a database-owned procedure. It stores the original file bytes in a private database schema, records the SHA-256 file hash, statement rows and import atomically, and creates no journal or cash-book movement. Same-account exact-file retries return the existing import. Matching transaction fingerprints are retained and flagged for review; provider transaction IDs remain unique per cash account.

Migrations `0040_bank_statement_imports.sql`, `0041_private_bank_import_source.sql` and `0042_statement_import_fingerprint_review.sql` were applied to the configured development Neon database. Lint, typecheck and production build passed. Automated, real-role authorization, replay/race and browser acceptance tests were not run, so the issue's required verification and human review remain open. Original source files can be recovered only by a privileged database operator; no source-file download UI is implemented by this story.
