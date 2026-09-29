# Database dictionary

Version 1.0 · 29 September 2026

This dictionary mirrors `reference-schema.sql`. `organization_id` scopes all tenant-owned rows. Monetary columns use exact domains. `auth.users` is supplied by Supabase and is not recreated.

**Delivery boundary:** full V1 table/column/foreign-key reference and read-only RLS baseline. Write command functions, cross-row guards and migration integration tests are implementation work, not silently supplied by this DDL. See `03-database-design.md`.

## 01. `profiles`

Non-financial user preferences; identity and passwords remain in Supabase Auth.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` |
| `display_name` | `text NOT NULL` |
| `locale` | `text NOT NULL DEFAULT 'en-BD'` |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Dhaka'` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 02. `organizations`

One legal company equals one isolated accounting tenant.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `name` | `text NOT NULL` |
| `slug` | `text NOT NULL UNIQUE` |
| `legal_name` | `text NOT NULL` |
| `country_code` | `char(2) NOT NULL DEFAULT 'BD'` |
| `base_currency` | `char(3) NOT NULL DEFAULT 'BDT' CHECK (base_currency = 'BDT')` |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Dhaka'` |
| `books_start_date` | `date NOT NULL` |
| `fiscal_year_start_month` | `smallint NOT NULL CHECK (fiscal_year_start_month BETWEEN 1 AND 12)` |
| `address` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `tax_identifiers` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','read_only','archived'))` |
| `single_operator_mode` | `boolean NOT NULL DEFAULT false` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 03. `organization_members`

Membership retained as an audit identity after login access is removed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `user_id` | `uuid REFERENCES auth.users(id) ON DELETE SET NULL` |
| `display_name_snapshot` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))` |
| `joined_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, user_id)`
- `CHECK (status <> 'active' OR user_id IS NOT NULL)`

## 04. `permissions`

Global permission catalogue, not a tenant-specific role assignment.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `description` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 05. `roles`

Company-specific named roles, seeded from documented templates.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `template_key` | `text` |
| `is_system` | `boolean NOT NULL DEFAULT false` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, name)`

## 06. `role_permissions`

Permissions granted to a role within the same company.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `role_id` | `uuid NOT NULL` |
| `permission_id` | `uuid NOT NULL REFERENCES finance.permissions(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, role_id, permission_id)`

## 07. `member_roles`

Many roles can be assigned to one membership, never across tenants.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `member_id` | `uuid NOT NULL` |
| `role_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, member_id, role_id)`

## 08. `invitations`

Expiring, single-use invitations; store only token hashes.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `email_normalized` | `text NOT NULL` |
| `role_id` | `uuid NOT NULL` |
| `token_hash` | `text NOT NULL UNIQUE` |
| `expires_at` | `timestamptz NOT NULL` |
| `invited_by_member_id` | `uuid NOT NULL` |
| `accepted_by_member_id` | `uuid` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, invited_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, accepted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 09. `fiscal_years`

Explicit reporting years, including unusual first-year lengths.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `label` | `text NOT NULL` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `CHECK (ends_on >= starts_on)`
- `UNIQUE (organization_id, label)`
- `EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`

## 10. `accounting_periods`

Regular posting periods plus a separate cutover opening period.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid` |
| `label` | `text NOT NULL` |
| `kind` | `text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','opening'))` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked'))` |
| `locked_at` | `timestamptz` |
| `locked_by_member_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, locked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `CHECK (ends_on >= starts_on)`
- `CHECK ((kind = 'regular' AND fiscal_year_id IS NOT NULL) OR (kind = 'opening' AND fiscal_year_id IS NULL AND starts_on = ends_on))`
- `CHECK ((status = 'locked' AND locked_at IS NOT NULL AND locked_by_member_id IS NOT NULL) OR (status = 'open' AND locked_at IS NULL AND locked_by_member_id IS NULL))`
- `EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`

## 11. `accounts`

Chart of accounts; used classification and control type cannot be silently changed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `parent_id` | `uuid` |
| `account_type` | `text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense'))` |
| `normal_side` | `text NOT NULL CHECK (normal_side IN ('debit','credit'))` |
| `report_group` | `text NOT NULL` |
| `control_kind` | `text CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance'))` |
| `is_postable` | `boolean NOT NULL DEFAULT true` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `is_system` | `boolean NOT NULL DEFAULT false` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, parent_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, code)`
- `CHECK (parent_id IS NULL OR parent_id <> id)`

## 12. `account_mappings`

Configurable system mappings such as AR, AP, output tax and retained earnings.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `mapping_key` | `text NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, mapping_key)`

## 13. `contacts`

Shared party directory. One contact can be both customer and supplier; balances stay separate.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `display_name` | `text NOT NULL` |
| `legal_name` | `text` |
| `is_customer` | `boolean NOT NULL DEFAULT false` |
| `is_vendor` | `boolean NOT NULL DEFAULT false` |
| `email` | `text` |
| `phone` | `text` |
| `billing_address` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `tax_identifiers` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `payment_terms_days` | `integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650)` |
| `credit_limit` | `finance.amount CHECK (credit_limit >= 0)` |
| `external_key` | `text` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `CHECK (is_customer OR is_vendor)`
- `UNIQUE (organization_id, external_key)`

## 14. `cost_centers`

Optional V1 department/location tagging; not consolidated branch accounting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, code)`

## 15. `tax_codes`

Effective-dated simple tax configurations. No built-in claim of statutory compliance.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `label` | `text NOT NULL` |
| `rate_percent` | `finance.rate NOT NULL` |
| `tax_kind` | `text NOT NULL CHECK (tax_kind IN ('standard','zero_rated','exempt','out_of_scope'))` |
| `output_account_id` | `uuid` |
| `input_account_id` | `uuid` |
| `recoverability` | `text NOT NULL DEFAULT 'none' CHECK (recoverability IN ('full','none'))` |
| `effective_from` | `date NOT NULL` |
| `effective_to` | `date` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, output_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, input_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, code, effective_from)`
- `CHECK (effective_to IS NULL OR effective_to >= effective_from)`
- `CHECK (tax_kind = 'standard' OR rate_percent = 0)`

## 16. `items`

Service/non-stock catalogue only. There is no V1 inventory valuation.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `sku` | `text` |
| `name` | `text NOT NULL` |
| `unit` | `text NOT NULL DEFAULT 'unit'` |
| `default_unit_price` | `finance.unit_price NOT NULL DEFAULT 0` |
| `sales_account_id` | `uuid` |
| `purchase_account_id` | `uuid` |
| `tax_code_id` | `uuid` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, sales_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, purchase_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, sku)`

## 17. `cash_accounts`

Maps each cash/bank/wallet account to exactly one GL account.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `kind` | `text NOT NULL CHECK (kind IN ('cash','bank','mobile_wallet','payment_clearing'))` |
| `institution` | `text` |
| `masked_account_number` | `text` |
| `is_cash_equivalent` | `boolean NOT NULL DEFAULT false` |
| `allow_negative_balance` | `boolean NOT NULL DEFAULT false` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, account_id)`

## 18. `document_sequences`

Counter rows locked at posting; issued numbers are never reused.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid NOT NULL` |
| `document_type` | `finance.document_type NOT NULL` |
| `prefix` | `text NOT NULL` |
| `next_value` | `bigint NOT NULL DEFAULT 1 CHECK (next_value > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, fiscal_year_id, document_type)`

## 19. `business_documents`

Common financial document envelope; financial fields become immutable after posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_type` | `finance.document_type NOT NULL` |
| `state` | `finance.document_state NOT NULL DEFAULT 'draft'` |
| `document_number` | `text` |
| `fiscal_year_id` | `uuid` |
| `party_id` | `uuid` |
| `issue_date` | `date NOT NULL` |
| `accounting_date` | `date NOT NULL` |
| `due_date` | `date` |
| `external_reference` | `text` |
| `description` | `text NOT NULL DEFAULT ''` |
| `currency` | `char(3) NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT')` |
| `net_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (net_amount >= 0)` |
| `tax_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (tax_amount >= 0)` |
| `rounding_adjustment` | `finance.amount NOT NULL DEFAULT 0 CHECK (abs(rounding_adjustment) <= 0.05)` |
| `total_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (total_amount >= 0)` |
| `party_snapshot` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `posted_by_member_id` | `uuid` |
| `posted_at` | `timestamptz` |
| `reversal_of_document_id` | `uuid` |
| `correction_reason` | `text` |
| `import_source_key` | `text` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, reversal_of_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_number)`
- `UNIQUE (organization_id, import_source_key)`
- `UNIQUE (organization_id, reversal_of_document_id)`
- `CHECK ((state = 'posted' AND document_number IS NOT NULL AND posted_at IS NOT NULL AND posted_by_member_id IS NOT NULL) OR (state <> 'posted' AND posted_at IS NULL AND posted_by_member_id IS NULL))`
- `CHECK (due_date IS NULL OR due_date >= issue_date)`
- `CHECK ((document_type = 'reversal' AND reversal_of_document_id IS NOT NULL AND correction_reason IS NOT NULL) OR (document_type <> 'reversal' AND reversal_of_document_id IS NULL))`

## 20. `trade_documents`

Typed extension for invoice, bill, credit note and paid-expense documents.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `original_document_id` | `uuid` |
| `recognition_mode` | `text NOT NULL DEFAULT 'earned_or_incurred' CHECK (recognition_mode IN ('earned_or_incurred','deferred_revenue'))` |
| `performance_confirmed` | `boolean NOT NULL DEFAULT false` |
| `supplier_invoice_date` | `date` |
| `supplier_invoice_key` | `text` |
| `terms` | `text` |
| `notes` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, original_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`

## 21. `document_lines`

Immutable posted item and tax snapshots; the server recomputes every amount.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `item_id` | `uuid` |
| `original_line_id` | `uuid` |
| `description` | `text NOT NULL` |
| `quantity` | `finance.quantity NOT NULL` |
| `unit_price` | `finance.unit_price NOT NULL` |
| `discount_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (discount_amount >= 0)` |
| `account_id` | `uuid NOT NULL` |
| `cost_center_id` | `uuid` |
| `tax_code_id` | `uuid` |
| `tax_label_snapshot` | `text` |
| `tax_rate_snapshot` | `finance.rate NOT NULL DEFAULT 0` |
| `tax_mode` | `text NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive'))` |
| `tax_recoverability_snapshot` | `text NOT NULL DEFAULT 'none' CHECK (tax_recoverability_snapshot IN ('full','none'))` |
| `tax_account_id` | `uuid` |
| `net_amount` | `finance.amount NOT NULL CHECK (net_amount >= 0)` |
| `tax_amount` | `finance.amount NOT NULL CHECK (tax_amount >= 0)` |
| `gross_amount` | `finance.amount NOT NULL CHECK (gross_amount >= 0)` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, original_line_id) REFERENCES finance.document_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, line_no)`
- `CHECK (gross_amount = net_amount + tax_amount)`

## 22. `money_movements`

Typed extension for receipts, payments, advances, refunds and paid-expense cash leg.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `cash_account_id` | `uuid NOT NULL` |
| `direction` | `text NOT NULL CHECK (direction IN ('in','out'))` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `method` | `text NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_wallet','card','other'))` |
| `reference` | `text` |
| `cash_flow_class` | `finance.cash_flow_class NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`

## 23. `transfers`

A transfer posts both cash legs in one transaction; fees are separate explicit lines.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `from_cash_account_id` | `uuid NOT NULL` |
| `to_cash_account_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `fee_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (fee_amount >= 0)` |
| `fee_account_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, from_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, to_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, fee_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`
- `CHECK (from_cash_account_id <> to_cash_account_id)`
- `CHECK (fee_amount = 0 OR fee_account_id IS NOT NULL)`

## 24. `manual_journal_rows`

Draft input for manual journals, opening balances and controlled adjustments; not the GL.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid` |
| `cost_center_id` | `uuid` |
| `debit` | `finance.amount NOT NULL DEFAULT 0` |
| `credit` | `finance.amount NOT NULL DEFAULT 0` |
| `description` | `text NOT NULL` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `open_item_reference` | `text` |
| `open_item_due_date` | `date` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, line_no)`
- `CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))`

## 25. `journal_entries`

One posted journal per financial document. building is transaction-local, never committed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `source_document_id` | `uuid NOT NULL` |
| `period_id` | `uuid NOT NULL` |
| `accounting_date` | `date NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'building' CHECK (state IN ('building','posted'))` |
| `is_opening` | `boolean NOT NULL DEFAULT false` |
| `is_year_close` | `boolean NOT NULL DEFAULT false` |
| `posted_at` | `timestamptz` |
| `posted_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, source_document_id)`
- `CHECK ((state = 'posted' AND posted_at IS NOT NULL) OR (state = 'building' AND posted_at IS NULL))`
- `CHECK (NOT (is_opening AND is_year_close))`

## 26. `journal_lines`

Authoritative double-entry ledger; debit or credit, never both or neither.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `journal_entry_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid` |
| `cost_center_id` | `uuid` |
| `debit` | `finance.amount NOT NULL DEFAULT 0` |
| `credit` | `finance.amount NOT NULL DEFAULT 0` |
| `description` | `text NOT NULL DEFAULT ''` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, journal_entry_id) REFERENCES finance.journal_entries (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, journal_entry_id, line_no)`
- `CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))`

## 27. `open_items`

One open item for every control-account ledger line; residual balances are derived.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `journal_line_id` | `uuid NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid NOT NULL` |
| `control_kind` | `text NOT NULL CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance'))` |
| `side` | `text NOT NULL CHECK (side IN ('debit','credit'))` |
| `original_amount` | `finance.amount NOT NULL CHECK (original_amount > 0)` |
| `reference` | `text NOT NULL` |
| `issue_date` | `date NOT NULL` |
| `due_date` | `date` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, journal_line_id)`

## 28. `document_allocation_plans`

Version-bound proposed settlements stored on the draft before approval; targets are real same-tenant open items.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `target_open_item_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, target_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, target_open_item_id)`

## 29. `settlement_allocations`

Append-only debit/credit matching within one party and control account; no duplicate GL posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `debit_open_item_id` | `uuid NOT NULL` |
| `credit_open_item_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `effective_date` | `date NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `source_document_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, debit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, credit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `CHECK (debit_open_item_id <> credit_open_item_id)`

## 30. `allocation_reversals`

Full reversal of an allocation at an effective date; original row is never deleted.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `allocation_id` | `uuid NOT NULL` |
| `effective_date` | `date NOT NULL` |
| `reason` | `text NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, allocation_id) REFERENCES finance.settlement_allocations (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, allocation_id)`

## 31. `bank_imports`

Raw statement provenance. Exact-file duplicates are blocked per bank account.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `cash_account_id` | `uuid NOT NULL` |
| `file_sha256` | `text NOT NULL` |
| `file_object_key` | `text NOT NULL` |
| `source_name` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','validated','imported','failed'))` |
| `row_count` | `integer NOT NULL DEFAULT 0 CHECK (row_count >= 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, cash_account_id, file_sha256)`

## 32. `statement_lines`

Immutable imported bank observations; importing is not financial posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `import_id` | `uuid NOT NULL` |
| `cash_account_id` | `uuid NOT NULL` |
| `row_no` | `integer NOT NULL CHECK (row_no > 0)` |
| `transaction_date` | `date NOT NULL` |
| `value_date` | `date` |
| `description` | `text NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount <> 0)` |
| `balance_after` | `finance.amount` |
| `source_transaction_id` | `text` |
| `fingerprint` | `text NOT NULL` |
| `raw_row` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, import_id) REFERENCES finance.bank_imports (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, import_id, row_no)`
- `UNIQUE (organization_id, cash_account_id, source_transaction_id)`

## 33. `reconciliations`

Bank statement session, difference and finalized evidence; not a second balance source.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `cash_account_id` | `uuid NOT NULL` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `statement_opening` | `finance.amount NOT NULL` |
| `statement_closing` | `finance.amount NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','finalized'))` |
| `finalized_by_member_id` | `uuid` |
| `finalized_at` | `timestamptz` |
| `evidence_snapshot` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, finalized_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `CHECK (ends_on >= starts_on)`
- `CHECK ((state = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL) OR (state = 'draft' AND finalized_at IS NULL AND finalized_by_member_id IS NULL))`

## 34. `reconciliation_matches`

Many-to-many partial bank-to-book matching, with capacity checks in the command layer.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `reconciliation_id` | `uuid NOT NULL` |
| `statement_line_id` | `uuid NOT NULL` |
| `journal_line_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, reconciliation_id) REFERENCES finance.reconciliations (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, statement_line_id) REFERENCES finance.statement_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, reconciliation_id, statement_line_id, journal_line_id)`

## 35. `approval_policies`

Simple V1 amount-based maker-checker rules; policy snapshots bind approvals to document versions.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `document_type` | `finance.document_type NOT NULL` |
| `threshold_amount` | `finance.amount NOT NULL CHECK (threshold_amount >= 0)` |
| `approver_role_id` | `uuid NOT NULL` |
| `required_approvals` | `integer NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 5)` |
| `allow_self_approval` | `boolean NOT NULL DEFAULT false` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, approver_role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, name)`

## 36. `approval_requests`

Submitted version/hash and policy requirements; later draft edits invalidate approval.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `document_version` | `integer NOT NULL CHECK (document_version > 0)` |
| `document_digest` | `text NOT NULL` |
| `policy_snapshot` | `jsonb NOT NULL` |
| `requested_by_member_id` | `uuid NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','superseded'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, document_version)`

## 37. `approval_decisions`

Append-only approval/rejection evidence, one decision per member per request.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `request_id` | `uuid NOT NULL` |
| `decided_by_member_id` | `uuid NOT NULL` |
| `decision` | `text NOT NULL CHECK (decision IN ('approve','reject'))` |
| `reason` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, request_id) REFERENCES finance.approval_requests (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, decided_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, request_id, decided_by_member_id)`

## 38. `attachments`

Private objects; store metadata and object paths, never public URLs.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `object_key` | `text NOT NULL` |
| `original_filename` | `text NOT NULL` |
| `content_type` | `text NOT NULL` |
| `byte_size` | `bigint NOT NULL CHECK (byte_size > 0)` |
| `sha256` | `text NOT NULL` |
| `scan_status` | `text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','rejected'))` |
| `uploaded_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, uploaded_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, object_key)`

## 39. `attachment_links`

Document-only attachment ownership avoids an unconstrained polymorphic financial link.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `attachment_id` | `uuid NOT NULL` |
| `document_id` | `uuid NOT NULL` |
| `linked_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, attachment_id) REFERENCES finance.attachments (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, linked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, attachment_id, document_id)`

## 40. `audit_events`

Append-only business/security history; do not store credentials or complete sensitive payloads.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `actor_member_id` | `uuid` |
| `actor_kind` | `text NOT NULL CHECK (actor_kind IN ('user','system','support'))` |
| `action` | `text NOT NULL` |
| `entity_type` | `text NOT NULL` |
| `entity_id` | `uuid` |
| `document_id` | `uuid` |
| `request_id` | `text NOT NULL` |
| `reason` | `text` |
| `redacted_change` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`

## 41. `period_events`

Append-only lock/reopen events with justification and a reconciliation checklist snapshot.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `period_id` | `uuid NOT NULL` |
| `action` | `text NOT NULL CHECK (action IN ('lock','reopen'))` |
| `actor_member_id` | `uuid NOT NULL` |
| `reason` | `text NOT NULL` |
| `checklist_snapshot` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 42. `import_jobs`

Staging and validation for contact, catalogue, opening-balance and supported transaction imports.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `import_type` | `text NOT NULL CHECK (import_type IN ('contacts','items','opening_balance','invoice_drafts','bill_drafts'))` |
| `file_sha256` | `text NOT NULL` |
| `file_object_key` | `text NOT NULL` |
| `mapping` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validating','ready','running','completed','failed'))` |
| `created_by_member_id` | `uuid NOT NULL` |
| `result_summary` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, import_type, file_sha256)`

## 43. `import_rows`

Row-level validation and result references enable safe retry without duplicate records.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `job_id` | `uuid NOT NULL` |
| `row_no` | `integer NOT NULL CHECK (row_no > 0)` |
| `input_data` | `jsonb NOT NULL` |
| `errors` | `jsonb NOT NULL DEFAULT '[]'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','imported'))` |
| `result_document_id` | `uuid` |
| `result_contact_id` | `uuid` |
| `result_item_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, job_id) REFERENCES finance.import_jobs (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_contact_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, job_id, row_no)`

## 44. `export_jobs`

Tenant-scoped report/document exports with request filters and historical ledger cutoff.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `requested_by_member_id` | `uuid NOT NULL` |
| `export_type` | `text NOT NULL` |
| `parameters` | `jsonb NOT NULL` |
| `ledger_cutoff_at` | `timestamptz NOT NULL` |
| `format` | `text NOT NULL CHECK (format IN ('csv','xlsx','pdf','json'))` |
| `status` | `text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','expired'))` |
| `object_key` | `text` |
| `expires_at` | `timestamptz` |
| `error_code` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 45. `report_snapshots`

Locked-period report evidence with filters, template version, ledger cutoff and checksum.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `period_id` | `uuid NOT NULL` |
| `report_type` | `text NOT NULL` |
| `parameters` | `jsonb NOT NULL` |
| `ledger_cutoff_at` | `timestamptz NOT NULL` |
| `template_version` | `text NOT NULL` |
| `result_sha256` | `text NOT NULL` |
| `object_key` | `text NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 46. `idempotency_requests`

Private command-deduplication record; same key with different request hash is rejected.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `operation` | `text NOT NULL` |
| `idempotency_key` | `text NOT NULL` |
| `request_hash` | `text NOT NULL` |
| `actor_member_id` | `uuid NOT NULL` |
| `response_status` | `integer NOT NULL` |
| `response_body` | `jsonb NOT NULL` |
| `resource_document_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, resource_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, operation, idempotency_key)`

## 47. `outbox_events`

Same-transaction event recording; workers perform email/PDF work only after financial commit.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `event_type` | `text NOT NULL` |
| `document_id` | `uuid` |
| `deduplication_key` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed'))` |
| `attempt_count` | `integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)` |
| `available_at` | `timestamptz NOT NULL DEFAULT now()` |
| `lease_until` | `timestamptz` |
| `last_error_code` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, deduplication_key)`

## 48. `notification_deliveries`

Separate delivery state: an email failure never changes invoice posting state.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `outbox_event_id` | `uuid NOT NULL` |
| `document_id` | `uuid` |
| `channel` | `text NOT NULL CHECK (channel IN ('email','in_app'))` |
| `recipient` | `text NOT NULL` |
| `provider_message_id` | `text` |
| `status` | `text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed'))` |
| `delivered_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, outbox_event_id) REFERENCES finance.outbox_events (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, outbox_event_id, channel, recipient)`

## 49. `plans`

SaaS product plans only; not the tenant company's own sales.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `name` | `text NOT NULL` |
| `entitlements` | `jsonb NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 50. `subscriptions`

One platform subscription per company. Prices and provider choices remain commercial decisions.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `plan_id` | `uuid NOT NULL REFERENCES finance.plans(id) ON DELETE RESTRICT` |
| `provider` | `text` |
| `provider_customer_id` | `text` |
| `provider_subscription_id` | `text` |
| `status` | `text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','read_only'))` |
| `current_period_start` | `timestamptz` |
| `current_period_end` | `timestamptz` |
| `grace_until` | `timestamptz` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id)`
- `UNIQUE (provider, provider_subscription_id)`

## 51. `billing_events`

Verified provider events; provider/event-ID uniqueness blocks duplicate webhook effects.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `provider` | `text NOT NULL` |
| `provider_event_id` | `text NOT NULL` |
| `event_type` | `text NOT NULL` |
| `payload_redacted` | `jsonb NOT NULL` |
| `processing_status` | `text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','failed','ignored'))` |
| `processed_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (provider, provider_event_id)`

## 52. `year_close_runs`

One close event per fiscal year; reopening is an audited reversal of the close document.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid NOT NULL` |
| `close_document_id` | `uuid NOT NULL` |
| `reopen_document_id` | `uuid` |
| `created_by_member_id` | `uuid NOT NULL` |
| `report_snapshot` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, close_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, reopen_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, close_document_id)`
