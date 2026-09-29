# Sources and Professional Review Boundaries
## Primary references checked for the 29 September 2026 specification

The requirements, schema, workflows and illustrative examples in this package are proposed product design. References below support the underlying accounting, database, security and accessibility principles; they are not endorsements or certification of this product. Bracketed source IDs used throughout the documents resolve here. URLs are provided for the implementation team's verification.

| ID | Primary source | Relevance and boundary |
|---|---|---|
| S1 | ACCA, *A matter of principle* | Accrual and double-entry foundations. Educational guidance; not a determination of a particular company's reporting obligations. |
| S2 | IFRS Foundation, *IFRS 15 Revenue from Contracts with Customers* | Recognition follows satisfaction of performance obligations; sending an invoice is not a sufficient universal recognition rule. V1 does not implement every IFRS 15 case. |
| S3 | IFRS Foundation, *IAS 7 Statement of Cash Flows* | Operating/investing/financing classification, non-cash exclusion and cash reconciliation. The proposed V1 report is a management report, not a certified IAS 7 statement. |
| S4 | PostgreSQL, *Constraints* | Composite foreign keys, uniqueness, and the limitations of row-local CHECK constraints for cross-row accounting invariants. |
| S5 | PostgreSQL, *Numeric Types* | Exact numeric storage and precision/scale behavior for monetary calculations, distinct from inexact floating point. |
| S6 | PostgreSQL, *Explicit Locking* | Row locks and transaction coordination supporting allocation, posting and closing commands. Real concurrent implementation tests remain required. |
| S7 | Supabase, *Row Level Security* | RLS policies and authorization boundaries; membership alone must not grant every financial capability. |
| S8 | Next.js, *Data Security* | Secure server-side access and explicit authorization of Server Actions; server execution is not a replacement for permission checks. |
| S9 | OWASP, *Authorization Cheat Sheet* | Deny-by-default, least privilege and authorization on protected requests. |
| S10 | W3C, *Web Content Accessibility Guidelines 2.2* | Proposed WCAG 2.2 AA usability/accessibility acceptance target; no conformance audit has been performed. |
| S11 | Bangladesh NBR, VAT compliance guidance and forms | VAT records/invoice requirements need local professional validation. No particular rate, registration threshold, filing requirement or retention period is hard-coded from this source. |
| S12 | Supabase, *Database Backups* | Database restoration is distinct from recovery of Storage object bytes; both require an operational plan. |
| S13 | Supabase, *Changelog* | Review relevant provider changes and pin supported dependencies during implementation. No unverified package version is mandated. |
| S14 | Supabase, *Database Functions* | Function execution/security configuration; deliberate restricted RPCs and hardened privileged helpers need implementation review. |
| S15 | Supabase, *Storage Access Control* | Private-object access policies complement database access policies. Bucket configuration and real download authorization are not implemented by the reference schema. |

## Reference locations

**S1 — ACCA:** `https://www.accaglobal.com/gb/en/student/exam-support-resources/foundation-level-study-resources/fa2/fa2-technical-articles/a-matter-of-principle.html`

**S2 — IFRS 15:** `https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/`

**S3 — IAS 7:** `https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/`

**S4 — PostgreSQL constraints:** `https://www.postgresql.org/docs/current/ddl-constraints.html`

**S5 — PostgreSQL numeric:** `https://www.postgresql.org/docs/current/datatype-numeric.html`

**S6 — PostgreSQL locks:** `https://www.postgresql.org/docs/current/explicit-locking.html`

**S7 — Supabase RLS:** `https://supabase.com/docs/guides/database/postgres/row-level-security`

**S8 — Next.js data security:** `https://nextjs.org/docs/app/guides/data-security`

**S9 — OWASP authorization:** `https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`

**S10 — WCAG 2.2:** `https://www.w3.org/TR/WCAG22/`

**S11 — NBR guidance:** `https://nbr.gov.bd/taxtypes/vat-compliance-guides/details/8/eng`

**S11 — NBR forms index:** `https://nbr.gov.bd/form/vat/vat-2012/eng`

**S12 — Supabase backups:** `https://supabase.com/docs/guides/platform/backups`

**S13 — Supabase changelog:** `https://supabase.com/changelog`

**S14 — Supabase functions:** `https://supabase.com/docs/guides/database/functions`

**S15 — Supabase Storage:** `https://supabase.com/docs/guides/storage/security/access-control`

## Required review before launch

A qualified accounting reviewer must approve account/report mappings, recognition and correction policies, opening balances, advance treatment, tax configuration, year-end behavior and representative financial statements. A local tax adviser must determine actual Bangladesh compliance requirements for the target entities. Security review must cover tenant isolation, role scope, privileged functions, private objects, exports, billing webhooks, incident handling and data recovery.

Neither this specification, its illustrative 10% tax examples, nor its reference-model tests certify statutory compliance, audited financial statements, a functioning application or production readiness.
