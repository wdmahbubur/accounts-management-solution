# ADR 0004: Country and accounting currency at company creation

Status: owner-requested implementation for review, 21 October 2026. Production migration/deployment is not authorized by this decision record.

Production follow-up, 24 October 2026: the owner separately authorized backup, migrations, dependency merges and deployment. The [production release record](../qa/production-country-currency-2026-10-24.md) records the actual rollout and live tests. Independent accounting and country-specific review remain open; the deployment is not manufactured sign-off.

The owner explicitly requested: “Add currency list and during company setup user will select the currency and country from there.” This extends the original BDT-only onboarding contract. The original v1.0 source documents remain unchanged. This record does not manufacture independent accounting or country-specific tax/legal approval.

Each company selects one country/region and one supported accounting currency when its books are created. Existing companies retain BDT. The choice is immutable: changing either requires separate books, rather than relabeling historical amounts. Documents must match their own company's currency at save, preview, posting and through linked settlements. Currency selection does not convert values, consolidate companies or enable foreign-currency transactions within one company.

Earlier onboarding accepted arbitrary two-letter country codes. The read contract retains those stored codes so existing books do not become inaccessible, while new company creation requires the pinned selection catalog. No legacy country is silently renamed or reclassified.

The current exact numeric(20,2) accounting engine supports only ISO 4217 currencies with two minor-unit decimal places. The pinned catalog contains 132 non-fund currency codes and 249 country/region codes. Zero-, three- and four-decimal currencies are not selectable; they require a separate precision/rounding design and accounting review. No floating-point money or silent precision truncation is introduced. Existing line/tax rounding and explicit adjustment limits remain numerically unchanged, expressed in the selected currency.

Country selection does not choose statutory tax rates, approve filing formats or certify regulatory coverage. Tax policy must be configured and reviewed for the company. Paid billing and privileged support access are explicitly deferred by the owner; they remain unavailable.

Catalog sources: [UN M49 country/area register](https://unstats.un.org/unsd/methodology/m49/overview/) with the ISO 3166-1 TW code, and [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), published 17 September 2026, retrieved 21 October 2026. Display names and order are pinned rather than generated independently by browser and server ICU/CLDR versions. Catalog updates require a reviewed forward migration and matching shared-contract update.

Migrations 0121–0123 add restricted catalogs and locale reads, enforce immutable company settings and document/company currency agreement, and update existing calculation/posting/read routines and new report snapshots. They do not rewrite journals, allocations, earlier snapshots or issued files. Legacy stored report snapshots without a currency field were created under the prior BDT-only contract and retain BDT rendering. New snapshots capture their company's currency.

Default transaction/report dates use the server's current calendar date in the stored company timezone. The database returns that date through the same live-membership locale reader; browser timezone/clock and the former Bangladesh-only helper do not supply company date defaults. An open form retains its chosen date rather than silently changing a saved accounting date at midnight. Posted date, period-lock and backdating rules remain authoritative.

Verification must include ordinary-role country/currency validation, onboarding retry races, mixed-currency denial, unchanged BDT regressions, non-BDT posting/settlements/reversals, private exports/PDFs, and Edge setup/switching behavior. Passing technical checks is not worldwide launch approval.
