-- Accounts Management SaaS | physical schema reference | v1.0 | 2026-09-29
-- NEW, EMPTY development database only. Assumes Supabase auth.users and roles exist.
-- This is a specification artifact, NOT an applied or integration-tested migration.
-- Application posting/settlement/reconciliation commands and cross-row guards are
-- specified in the accompanying documents and MUST be implemented before writes.
-- Default-deny access is intentional. Do not grant broad DML to make the app work.
-- Create versioned migrations using the Supabase CLI when implementation begins.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE DOMAIN finance.amount AS numeric(20,2)
  CHECK (VALUE <> 'NaN'::numeric);
CREATE DOMAIN finance.quantity AS numeric(20,6)
  CHECK (VALUE > 0 AND VALUE <> 'NaN'::numeric);
CREATE DOMAIN finance.unit_price AS numeric(20,6)
  CHECK (VALUE >= 0 AND VALUE <> 'NaN'::numeric);
CREATE DOMAIN finance.rate AS numeric(9,6)
  CHECK (VALUE >= 0 AND VALUE <= 100 AND VALUE <> 'NaN'::numeric);
CREATE TYPE finance.document_state AS ENUM ('draft','pending_approval','approved','posted','void');
CREATE TYPE finance.document_type AS ENUM (
 'invoice','customer_credit','bill','vendor_credit','paid_expense',
 'receipt','vendor_payment','customer_refund','vendor_refund',
 'customer_advance','vendor_advance','advance_application','transfer',
 'manual_journal','controlled_adjustment','deferred_revenue_release',
 'write_off','opening_balance','year_close','reversal');
CREATE TYPE finance.cash_flow_class AS ENUM ('operating','investing','financing','internal','opening','unclassified');

-- Non-financial user preferences; identity and passwords remain in Supabase Auth.
CREATE TABLE finance.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'en-BD',
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One legal company equals one isolated accounting tenant.
CREATE TABLE finance.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'BD',
  base_currency char(3) NOT NULL DEFAULT 'BDT' CHECK (base_currency = 'BDT'),
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  books_start_date date NOT NULL,
  fiscal_year_start_month smallint NOT NULL CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','read_only','archived')),
  single_operator_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Membership retained as an audit identity after login access is removed.
CREATE TABLE finance.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id),
  CHECK (status <> 'active' OR user_id IS NOT NULL)
);
CREATE INDEX organization_members_user_id_idx ON finance.organization_members (organization_id, user_id);

-- Global permission catalogue, not a tenant-specific role assignment.
CREATE TABLE finance.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Company-specific named roles, seeded from documented templates.
CREATE TABLE finance.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  template_key text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

-- Permissions granted to a role within the same company.
CREATE TABLE finance.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES finance.permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, role_id, permission_id)
);
CREATE INDEX role_permissions_role_id_idx ON finance.role_permissions (organization_id, role_id);
CREATE INDEX role_permissions_permission_id_idx ON finance.role_permissions (organization_id, permission_id);

-- Many roles can be assigned to one membership, never across tenants.
CREATE TABLE finance.member_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, member_id, role_id)
);
CREATE INDEX member_roles_member_id_idx ON finance.member_roles (organization_id, member_id);
CREATE INDEX member_roles_role_id_idx ON finance.member_roles (organization_id, role_id);

-- Expiring, single-use invitations; store only token hashes.
CREATE TABLE finance.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  role_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  invited_by_member_id uuid NOT NULL,
  accepted_by_member_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, invited_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, accepted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX invitations_role_id_idx ON finance.invitations (organization_id, role_id);
CREATE INDEX invitations_invited_by_member_id_idx ON finance.invitations (organization_id, invited_by_member_id);
CREATE INDEX invitations_accepted_by_member_id_idx ON finance.invitations (organization_id, accepted_by_member_id);

-- Explicit reporting years, including unusual first-year lengths.
CREATE TABLE finance.fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  label text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (ends_on >= starts_on),
  UNIQUE (organization_id, label),
  EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);

-- Regular posting periods plus a separate cutover opening period.
CREATE TABLE finance.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  fiscal_year_id uuid,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','opening')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
  locked_at timestamptz,
  locked_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, locked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  CHECK (ends_on >= starts_on),
  CHECK ((kind = 'regular' AND fiscal_year_id IS NOT NULL) OR (kind = 'opening' AND fiscal_year_id IS NULL AND starts_on = ends_on)),
  CHECK ((status = 'locked' AND locked_at IS NOT NULL AND locked_by_member_id IS NOT NULL) OR (status = 'open' AND locked_at IS NULL AND locked_by_member_id IS NULL)),
  EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE INDEX accounting_periods_fiscal_year_id_idx ON finance.accounting_periods (organization_id, fiscal_year_id);
CREATE INDEX accounting_periods_locked_by_member_id_idx ON finance.accounting_periods (organization_id, locked_by_member_id);

-- Chart of accounts; used classification and control type cannot be silently changed.
CREATE TABLE finance.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  normal_side text NOT NULL CHECK (normal_side IN ('debit','credit')),
  report_group text NOT NULL,
  control_kind text CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance')),
  is_postable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, parent_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX accounts_parent_id_idx ON finance.accounts (organization_id, parent_id);

-- Configurable system mappings such as AR, AP, output tax and retained earnings.
CREATE TABLE finance.account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  mapping_key text NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, mapping_key)
);
CREATE INDEX account_mappings_account_id_idx ON finance.account_mappings (organization_id, account_id);

-- Shared party directory. One contact can be both customer and supplier; balances stay separate.
CREATE TABLE finance.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  legal_name text,
  is_customer boolean NOT NULL DEFAULT false,
  is_vendor boolean NOT NULL DEFAULT false,
  email text,
  phone text,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650),
  credit_limit finance.amount CHECK (credit_limit >= 0),
  external_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (is_customer OR is_vendor),
  UNIQUE (organization_id, external_key)
);

-- Optional V1 department/location tagging; not consolidated branch accounting.
CREATE TABLE finance.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

-- Effective-dated simple tax configurations. No built-in claim of statutory compliance.
CREATE TABLE finance.tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  code text NOT NULL,
  label text NOT NULL,
  rate_percent finance.rate NOT NULL,
  tax_kind text NOT NULL CHECK (tax_kind IN ('standard','zero_rated','exempt','out_of_scope')),
  output_account_id uuid,
  input_account_id uuid,
  recoverability text NOT NULL DEFAULT 'none' CHECK (recoverability IN ('full','none')),
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, output_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, input_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, code, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (tax_kind = 'standard' OR rate_percent = 0)
);
CREATE INDEX tax_codes_output_account_id_idx ON finance.tax_codes (organization_id, output_account_id);
CREATE INDEX tax_codes_input_account_id_idx ON finance.tax_codes (organization_id, input_account_id);

-- Service/non-stock catalogue only. There is no V1 inventory valuation.
CREATE TABLE finance.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  sku text,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'unit',
  default_unit_price finance.unit_price NOT NULL DEFAULT 0,
  sales_account_id uuid,
  purchase_account_id uuid,
  tax_code_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, sales_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, purchase_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, sku)
);
CREATE INDEX items_sales_account_id_idx ON finance.items (organization_id, sales_account_id);
CREATE INDEX items_purchase_account_id_idx ON finance.items (organization_id, purchase_account_id);
CREATE INDEX items_tax_code_id_idx ON finance.items (organization_id, tax_code_id);

-- Maps each cash/bank/wallet account to exactly one GL account.
CREATE TABLE finance.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash','bank','mobile_wallet','payment_clearing')),
  institution text,
  masked_account_number text,
  is_cash_equivalent boolean NOT NULL DEFAULT false,
  allow_negative_balance boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, account_id)
);
CREATE INDEX cash_accounts_account_id_idx ON finance.cash_accounts (organization_id, account_id);

-- Counter rows locked at posting; issued numbers are never reused.
CREATE TABLE finance.document_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL,
  document_type finance.document_type NOT NULL,
  prefix text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, fiscal_year_id, document_type)
);
CREATE INDEX document_sequences_fiscal_year_id_idx ON finance.document_sequences (organization_id, fiscal_year_id);

-- Common financial document envelope; financial fields become immutable after posting.
CREATE TABLE finance.business_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_type finance.document_type NOT NULL,
  state finance.document_state NOT NULL DEFAULT 'draft',
  document_number text,
  fiscal_year_id uuid,
  party_id uuid,
  issue_date date NOT NULL,
  accounting_date date NOT NULL,
  due_date date,
  external_reference text,
  description text NOT NULL DEFAULT '',
  currency char(3) NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  net_amount finance.amount NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  tax_amount finance.amount NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  rounding_adjustment finance.amount NOT NULL DEFAULT 0 CHECK (abs(rounding_adjustment) <= 0.05),
  total_amount finance.amount NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  party_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_member_id uuid NOT NULL,
  posted_by_member_id uuid,
  posted_at timestamptz,
  reversal_of_document_id uuid,
  correction_reason text,
  import_source_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reversal_of_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, import_source_key),
  UNIQUE (organization_id, reversal_of_document_id),
  CHECK ((state = 'posted' AND document_number IS NOT NULL AND posted_at IS NOT NULL AND posted_by_member_id IS NOT NULL) OR (state <> 'posted' AND posted_at IS NULL AND posted_by_member_id IS NULL)),
  CHECK (due_date IS NULL OR due_date >= issue_date),
  CHECK ((document_type = 'reversal' AND reversal_of_document_id IS NOT NULL AND correction_reason IS NOT NULL) OR (document_type <> 'reversal' AND reversal_of_document_id IS NULL))
);
CREATE INDEX documents_date_idx ON finance.business_documents (organization_id, accounting_date DESC, id);
CREATE INDEX documents_party_idx ON finance.business_documents (organization_id, party_id, accounting_date DESC);
CREATE INDEX documents_state_idx ON finance.business_documents (organization_id, document_type, state, accounting_date DESC);
CREATE INDEX business_documents_fiscal_year_id_idx ON finance.business_documents (organization_id, fiscal_year_id);
CREATE INDEX business_documents_party_id_idx ON finance.business_documents (organization_id, party_id);
CREATE INDEX business_documents_created_by_member_id_idx ON finance.business_documents (organization_id, created_by_member_id);
CREATE INDEX business_documents_posted_by_member_id_idx ON finance.business_documents (organization_id, posted_by_member_id);
CREATE INDEX business_documents_reversal_of_document_id_idx ON finance.business_documents (organization_id, reversal_of_document_id);

-- Typed extension for invoice, bill, credit note and paid-expense documents.
CREATE TABLE finance.trade_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  original_document_id uuid,
  recognition_mode text NOT NULL DEFAULT 'earned_or_incurred' CHECK (recognition_mode IN ('earned_or_incurred','deferred_revenue')),
  performance_confirmed boolean NOT NULL DEFAULT false,
  supplier_invoice_date date,
  supplier_invoice_key text,
  terms text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, original_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id)
);
CREATE INDEX trade_documents_document_id_idx ON finance.trade_documents (organization_id, document_id);
CREATE INDEX trade_documents_original_document_id_idx ON finance.trade_documents (organization_id, original_document_id);

-- Immutable posted item and tax snapshots; the server recomputes every amount.
CREATE TABLE finance.document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_id uuid,
  original_line_id uuid,
  description text NOT NULL,
  quantity finance.quantity NOT NULL,
  unit_price finance.unit_price NOT NULL,
  discount_amount finance.amount NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  account_id uuid NOT NULL,
  cost_center_id uuid,
  tax_code_id uuid,
  tax_label_snapshot text,
  tax_rate_snapshot finance.rate NOT NULL DEFAULT 0,
  tax_mode text NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive')),
  tax_recoverability_snapshot text NOT NULL DEFAULT 'none' CHECK (tax_recoverability_snapshot IN ('full','none')),
  tax_account_id uuid,
  net_amount finance.amount NOT NULL CHECK (net_amount >= 0),
  tax_amount finance.amount NOT NULL CHECK (tax_amount >= 0),
  gross_amount finance.amount NOT NULL CHECK (gross_amount >= 0),
  cash_flow_class finance.cash_flow_class,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, original_line_id) REFERENCES finance.document_lines (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, tax_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id, line_no),
  CHECK (gross_amount = net_amount + tax_amount)
);
CREATE INDEX document_lines_document_id_idx ON finance.document_lines (organization_id, document_id);
CREATE INDEX document_lines_item_id_idx ON finance.document_lines (organization_id, item_id);
CREATE INDEX document_lines_original_line_id_idx ON finance.document_lines (organization_id, original_line_id);
CREATE INDEX document_lines_account_id_idx ON finance.document_lines (organization_id, account_id);
CREATE INDEX document_lines_cost_center_id_idx ON finance.document_lines (organization_id, cost_center_id);
CREATE INDEX document_lines_tax_code_id_idx ON finance.document_lines (organization_id, tax_code_id);
CREATE INDEX document_lines_tax_account_id_idx ON finance.document_lines (organization_id, tax_account_id);

-- Typed extension for receipts, payments, advances, refunds and paid-expense cash leg.
CREATE TABLE finance.money_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  cash_account_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount finance.amount NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_wallet','card','other')),
  reference text,
  cash_flow_class finance.cash_flow_class NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id)
);
CREATE INDEX money_movements_document_id_idx ON finance.money_movements (organization_id, document_id);
CREATE INDEX money_movements_cash_account_id_idx ON finance.money_movements (organization_id, cash_account_id);

-- A transfer posts both cash legs in one transaction; fees are separate explicit lines.
CREATE TABLE finance.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  from_cash_account_id uuid NOT NULL,
  to_cash_account_id uuid NOT NULL,
  amount finance.amount NOT NULL CHECK (amount > 0),
  fee_amount finance.amount NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, from_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, to_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, fee_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id),
  CHECK (from_cash_account_id <> to_cash_account_id),
  CHECK (fee_amount = 0 OR fee_account_id IS NOT NULL)
);
CREATE INDEX transfers_document_id_idx ON finance.transfers (organization_id, document_id);
CREATE INDEX transfers_from_cash_account_id_idx ON finance.transfers (organization_id, from_cash_account_id);
CREATE INDEX transfers_to_cash_account_id_idx ON finance.transfers (organization_id, to_cash_account_id);
CREATE INDEX transfers_fee_account_id_idx ON finance.transfers (organization_id, fee_account_id);

-- Draft input for manual journals, opening balances and controlled adjustments; not the GL.
CREATE TABLE finance.manual_journal_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  account_id uuid NOT NULL,
  party_id uuid,
  cost_center_id uuid,
  debit finance.amount NOT NULL DEFAULT 0,
  credit finance.amount NOT NULL DEFAULT 0,
  description text NOT NULL,
  cash_flow_class finance.cash_flow_class,
  open_item_reference text,
  open_item_due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id, line_no),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX manual_journal_rows_document_id_idx ON finance.manual_journal_rows (organization_id, document_id);
CREATE INDEX manual_journal_rows_account_id_idx ON finance.manual_journal_rows (organization_id, account_id);
CREATE INDEX manual_journal_rows_party_id_idx ON finance.manual_journal_rows (organization_id, party_id);
CREATE INDEX manual_journal_rows_cost_center_id_idx ON finance.manual_journal_rows (organization_id, cost_center_id);

-- One posted journal per financial document. building is transaction-local, never committed.
CREATE TABLE finance.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL,
  period_id uuid NOT NULL,
  accounting_date date NOT NULL,
  state text NOT NULL DEFAULT 'building' CHECK (state IN ('building','posted')),
  is_opening boolean NOT NULL DEFAULT false,
  is_year_close boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  posted_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, source_document_id),
  CHECK ((state = 'posted' AND posted_at IS NOT NULL) OR (state = 'building' AND posted_at IS NULL)),
  CHECK (NOT (is_opening AND is_year_close))
);
CREATE INDEX journal_period_idx ON finance.journal_entries (organization_id, period_id, accounting_date, id);
CREATE INDEX journal_entries_source_document_id_idx ON finance.journal_entries (organization_id, source_document_id);
CREATE INDEX journal_entries_period_id_idx ON finance.journal_entries (organization_id, period_id);
CREATE INDEX journal_entries_posted_by_member_id_idx ON finance.journal_entries (organization_id, posted_by_member_id);

-- Authoritative double-entry ledger; debit or credit, never both or neither.
CREATE TABLE finance.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  account_id uuid NOT NULL,
  party_id uuid,
  cost_center_id uuid,
  debit finance.amount NOT NULL DEFAULT 0,
  credit finance.amount NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  cash_flow_class finance.cash_flow_class,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES finance.journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, journal_entry_id, line_no),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX ledger_account_idx ON finance.journal_lines (organization_id, account_id, journal_entry_id);
CREATE INDEX ledger_party_idx ON finance.journal_lines (organization_id, party_id, account_id);
CREATE INDEX journal_lines_journal_entry_id_idx ON finance.journal_lines (organization_id, journal_entry_id);
CREATE INDEX journal_lines_account_id_idx ON finance.journal_lines (organization_id, account_id);
CREATE INDEX journal_lines_party_id_idx ON finance.journal_lines (organization_id, party_id);
CREATE INDEX journal_lines_cost_center_id_idx ON finance.journal_lines (organization_id, cost_center_id);

-- One open item for every control-account ledger line; residual balances are derived.
CREATE TABLE finance.open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  journal_line_id uuid NOT NULL,
  account_id uuid NOT NULL,
  party_id uuid NOT NULL,
  control_kind text NOT NULL CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance')),
  side text NOT NULL CHECK (side IN ('debit','credit')),
  original_amount finance.amount NOT NULL CHECK (original_amount > 0),
  reference text NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, journal_line_id)
);
CREATE INDEX open_items_party_idx ON finance.open_items (organization_id, party_id, control_kind, due_date);
CREATE INDEX open_items_journal_line_id_idx ON finance.open_items (organization_id, journal_line_id);
CREATE INDEX open_items_account_id_idx ON finance.open_items (organization_id, account_id);
CREATE INDEX open_items_party_id_idx ON finance.open_items (organization_id, party_id);

-- Version-bound proposed settlements stored on the draft before approval; targets are real same-tenant open items.
CREATE TABLE finance.document_allocation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  target_open_item_id uuid NOT NULL,
  amount finance.amount NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, target_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id, target_open_item_id)
);
CREATE INDEX document_allocation_plans_document_id_idx ON finance.document_allocation_plans (organization_id, document_id);
CREATE INDEX document_allocation_plans_target_open_item_id_idx ON finance.document_allocation_plans (organization_id, target_open_item_id);

-- Append-only debit/credit matching within one party and control account; no duplicate GL posting.
CREATE TABLE finance.settlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  debit_open_item_id uuid NOT NULL,
  credit_open_item_id uuid NOT NULL,
  amount finance.amount NOT NULL CHECK (amount > 0),
  effective_date date NOT NULL,
  created_by_member_id uuid NOT NULL,
  source_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, debit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, credit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  CHECK (debit_open_item_id <> credit_open_item_id)
);
CREATE INDEX alloc_debit_idx ON finance.settlement_allocations (organization_id, debit_open_item_id, effective_date);
CREATE INDEX alloc_credit_idx ON finance.settlement_allocations (organization_id, credit_open_item_id, effective_date);
CREATE INDEX settlement_allocations_debit_open_item_id_idx ON finance.settlement_allocations (organization_id, debit_open_item_id);
CREATE INDEX settlement_allocations_credit_open_item_id_idx ON finance.settlement_allocations (organization_id, credit_open_item_id);
CREATE INDEX settlement_allocations_created_by_member_id_idx ON finance.settlement_allocations (organization_id, created_by_member_id);
CREATE INDEX settlement_allocations_source_document_id_idx ON finance.settlement_allocations (organization_id, source_document_id);

-- Full reversal of an allocation at an effective date; original row is never deleted.
CREATE TABLE finance.allocation_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL,
  effective_date date NOT NULL,
  reason text NOT NULL,
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, allocation_id) REFERENCES finance.settlement_allocations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, allocation_id)
);
CREATE INDEX allocation_reversals_allocation_id_idx ON finance.allocation_reversals (organization_id, allocation_id);
CREATE INDEX allocation_reversals_created_by_member_id_idx ON finance.allocation_reversals (organization_id, created_by_member_id);

-- Raw statement provenance. Exact-file duplicates are blocked per bank account.
CREATE TABLE finance.bank_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  cash_account_id uuid NOT NULL,
  file_sha256 text NOT NULL,
  file_object_key text NOT NULL,
  source_name text NOT NULL,
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','validated','imported','failed')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, cash_account_id, file_sha256)
);
CREATE INDEX bank_imports_cash_account_id_idx ON finance.bank_imports (organization_id, cash_account_id);
CREATE INDEX bank_imports_created_by_member_id_idx ON finance.bank_imports (organization_id, created_by_member_id);

-- Immutable imported bank observations; importing is not financial posting.
CREATE TABLE finance.statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  import_id uuid NOT NULL,
  cash_account_id uuid NOT NULL,
  row_no integer NOT NULL CHECK (row_no > 0),
  transaction_date date NOT NULL,
  value_date date,
  description text NOT NULL,
  amount finance.amount NOT NULL CHECK (amount <> 0),
  balance_after finance.amount,
  source_transaction_id text,
  fingerprint text NOT NULL,
  raw_row jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, import_id) REFERENCES finance.bank_imports (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, import_id, row_no),
  UNIQUE (organization_id, cash_account_id, source_transaction_id)
);
CREATE INDEX statement_date_idx ON finance.statement_lines (organization_id, cash_account_id, transaction_date, id);
CREATE INDEX statement_fingerprint_idx ON finance.statement_lines (organization_id, cash_account_id, fingerprint);
CREATE INDEX statement_lines_import_id_idx ON finance.statement_lines (organization_id, import_id);
CREATE INDEX statement_lines_cash_account_id_idx ON finance.statement_lines (organization_id, cash_account_id);
CREATE INDEX statement_lines_source_transaction_id_idx ON finance.statement_lines (organization_id, source_transaction_id);

-- Bank statement session, difference and finalized evidence; not a second balance source.
CREATE TABLE finance.reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  cash_account_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  statement_opening finance.amount NOT NULL,
  statement_closing finance.amount NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','finalized')),
  finalized_by_member_id uuid,
  finalized_at timestamptz,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, finalized_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  CHECK (ends_on >= starts_on),
  CHECK ((state = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL) OR (state = 'draft' AND finalized_at IS NULL AND finalized_by_member_id IS NULL))
);
CREATE INDEX reconciliations_cash_account_id_idx ON finance.reconciliations (organization_id, cash_account_id);
CREATE INDEX reconciliations_finalized_by_member_id_idx ON finance.reconciliations (organization_id, finalized_by_member_id);

-- Many-to-many partial bank-to-book matching, with capacity checks in the command layer.
CREATE TABLE finance.reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL,
  statement_line_id uuid NOT NULL,
  journal_line_id uuid NOT NULL,
  amount finance.amount NOT NULL CHECK (amount > 0),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reconciliation_id) REFERENCES finance.reconciliations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, statement_line_id) REFERENCES finance.statement_lines (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, reconciliation_id, statement_line_id, journal_line_id)
);
CREATE INDEX reconciliation_matches_reconciliation_id_idx ON finance.reconciliation_matches (organization_id, reconciliation_id);
CREATE INDEX reconciliation_matches_statement_line_id_idx ON finance.reconciliation_matches (organization_id, statement_line_id);
CREATE INDEX reconciliation_matches_journal_line_id_idx ON finance.reconciliation_matches (organization_id, journal_line_id);
CREATE INDEX reconciliation_matches_created_by_member_id_idx ON finance.reconciliation_matches (organization_id, created_by_member_id);

-- Simple V1 amount-based maker-checker rules; policy snapshots bind approvals to document versions.
CREATE TABLE finance.approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  document_type finance.document_type NOT NULL,
  threshold_amount finance.amount NOT NULL CHECK (threshold_amount >= 0),
  approver_role_id uuid NOT NULL,
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 5),
  allow_self_approval boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, approver_role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, name)
);
CREATE INDEX approval_policies_approver_role_id_idx ON finance.approval_policies (organization_id, approver_role_id);

-- Submitted version/hash and policy requirements; later draft edits invalidate approval.
CREATE TABLE finance.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  document_version integer NOT NULL CHECK (document_version > 0),
  document_digest text NOT NULL,
  policy_snapshot jsonb NOT NULL,
  requested_by_member_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, document_id, document_version)
);
CREATE INDEX approval_requests_document_id_idx ON finance.approval_requests (organization_id, document_id);
CREATE INDEX approval_requests_requested_by_member_id_idx ON finance.approval_requests (organization_id, requested_by_member_id);

-- Append-only approval/rejection evidence, one decision per member per request.
CREATE TABLE finance.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  decided_by_member_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, request_id) REFERENCES finance.approval_requests (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, request_id, decided_by_member_id)
);
CREATE INDEX approval_decisions_request_id_idx ON finance.approval_decisions (organization_id, request_id);
CREATE INDEX approval_decisions_decided_by_member_id_idx ON finance.approval_decisions (organization_id, decided_by_member_id);

-- Private objects; store metadata and object paths, never public URLs.
CREATE TABLE finance.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','rejected')),
  uploaded_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, uploaded_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, object_key)
);
CREATE INDEX attachments_uploaded_by_member_id_idx ON finance.attachments (organization_id, uploaded_by_member_id);

-- Document-only attachment ownership avoids an unconstrained polymorphic financial link.
CREATE TABLE finance.attachment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  attachment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  linked_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, attachment_id) REFERENCES finance.attachments (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, linked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, attachment_id, document_id)
);
CREATE INDEX attachment_links_attachment_id_idx ON finance.attachment_links (organization_id, attachment_id);
CREATE INDEX attachment_links_document_id_idx ON finance.attachment_links (organization_id, document_id);
CREATE INDEX attachment_links_linked_by_member_id_idx ON finance.attachment_links (organization_id, linked_by_member_id);

-- Append-only business/security history; do not store credentials or complete sensitive payloads.
CREATE TABLE finance.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  actor_member_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','system','support')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  document_id uuid,
  request_id text NOT NULL,
  reason text,
  redacted_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_time_idx ON finance.audit_events (organization_id, created_at DESC, id);
CREATE INDEX audit_entity_idx ON finance.audit_events (organization_id, entity_type, entity_id);
CREATE INDEX audit_events_actor_member_id_idx ON finance.audit_events (organization_id, actor_member_id);
CREATE INDEX audit_events_entity_id_idx ON finance.audit_events (organization_id, entity_id);
CREATE INDEX audit_events_document_id_idx ON finance.audit_events (organization_id, document_id);
CREATE INDEX audit_events_request_id_idx ON finance.audit_events (organization_id, request_id);

-- Append-only lock/reopen events with justification and a reconciliation checklist snapshot.
CREATE TABLE finance.period_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('lock','reopen')),
  actor_member_id uuid NOT NULL,
  reason text NOT NULL,
  checklist_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX period_events_period_id_idx ON finance.period_events (organization_id, period_id);
CREATE INDEX period_events_actor_member_id_idx ON finance.period_events (organization_id, actor_member_id);

-- Staging and validation for contact, catalogue, opening-balance and supported transaction imports.
CREATE TABLE finance.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  import_type text NOT NULL CHECK (import_type IN ('contacts','items','opening_balance','invoice_drafts','bill_drafts')),
  file_sha256 text NOT NULL,
  file_object_key text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validating','ready','running','completed','failed')),
  created_by_member_id uuid NOT NULL,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, import_type, file_sha256)
);
CREATE INDEX import_jobs_created_by_member_id_idx ON finance.import_jobs (organization_id, created_by_member_id);

-- Row-level validation and result references enable safe retry without duplicate records.
CREATE TABLE finance.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  row_no integer NOT NULL CHECK (row_no > 0),
  input_data jsonb NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','imported')),
  result_document_id uuid,
  result_contact_id uuid,
  result_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES finance.import_jobs (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, result_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, result_contact_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, result_item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, job_id, row_no)
);
CREATE INDEX import_rows_job_id_idx ON finance.import_rows (organization_id, job_id);
CREATE INDEX import_rows_result_document_id_idx ON finance.import_rows (organization_id, result_document_id);
CREATE INDEX import_rows_result_contact_id_idx ON finance.import_rows (organization_id, result_contact_id);
CREATE INDEX import_rows_result_item_id_idx ON finance.import_rows (organization_id, result_item_id);

-- Tenant-scoped report/document exports with request filters and historical ledger cutoff.
CREATE TABLE finance.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  requested_by_member_id uuid NOT NULL,
  export_type text NOT NULL,
  parameters jsonb NOT NULL,
  ledger_cutoff_at timestamptz NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','xlsx','pdf','json')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','expired')),
  object_key text,
  expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX export_jobs_requested_by_member_id_idx ON finance.export_jobs (organization_id, requested_by_member_id);

-- Locked-period report evidence with filters, template version, ledger cutoff and checksum.
CREATE TABLE finance.report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  report_type text NOT NULL,
  parameters jsonb NOT NULL,
  ledger_cutoff_at timestamptz NOT NULL,
  template_version text NOT NULL,
  result_sha256 text NOT NULL,
  object_key text NOT NULL,
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX report_snapshots_period_id_idx ON finance.report_snapshots (organization_id, period_id);
CREATE INDEX report_snapshots_created_by_member_id_idx ON finance.report_snapshots (organization_id, created_by_member_id);

-- Private command-deduplication record; same key with different request hash is rejected.
CREATE TABLE finance.idempotency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  actor_member_id uuid NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  resource_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, resource_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, operation, idempotency_key)
);
CREATE INDEX idempotency_requests_actor_member_id_idx ON finance.idempotency_requests (organization_id, actor_member_id);
CREATE INDEX idempotency_requests_resource_document_id_idx ON finance.idempotency_requests (organization_id, resource_document_id);

-- Same-transaction event recording; workers perform email/PDF work only after financial commit.
CREATE TABLE finance.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  document_id uuid,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, deduplication_key)
);
CREATE INDEX outbox_queue_idx ON finance.outbox_events (status, available_at);
CREATE INDEX outbox_events_document_id_idx ON finance.outbox_events (organization_id, document_id);

-- Separate delivery state: an email failure never changes invoice posting state.
CREATE TABLE finance.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  outbox_event_id uuid NOT NULL,
  document_id uuid,
  channel text NOT NULL CHECK (channel IN ('email','in_app')),
  recipient text NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, outbox_event_id) REFERENCES finance.outbox_events (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, outbox_event_id, channel, recipient)
);
CREATE INDEX notification_deliveries_outbox_event_id_idx ON finance.notification_deliveries (organization_id, outbox_event_id);
CREATE INDEX notification_deliveries_document_id_idx ON finance.notification_deliveries (organization_id, document_id);
CREATE INDEX notification_deliveries_provider_message_id_idx ON finance.notification_deliveries (organization_id, provider_message_id);

-- SaaS product plans only; not the tenant company's own sales.
CREATE TABLE finance.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  entitlements jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One platform subscription per company. Prices and provider choices remain commercial decisions.
CREATE TABLE finance.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES finance.plans(id) ON DELETE RESTRICT,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  status text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','read_only')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id),
  UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX subscriptions_plan_id_idx ON finance.subscriptions (organization_id, plan_id);
CREATE INDEX subscriptions_provider_customer_id_idx ON finance.subscriptions (organization_id, provider_customer_id);
CREATE INDEX subscriptions_provider_subscription_id_idx ON finance.subscriptions (organization_id, provider_subscription_id);

-- Verified provider events; provider/event-ID uniqueness blocks duplicate webhook effects.
CREATE TABLE finance.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_redacted jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','failed','ignored')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX billing_events_provider_event_id_idx ON finance.billing_events (organization_id, provider_event_id);

-- One close event per fiscal year; reopening is an audited reversal of the close document.
CREATE TABLE finance.year_close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL,
  close_document_id uuid NOT NULL,
  reopen_document_id uuid,
  created_by_member_id uuid NOT NULL,
  report_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, close_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reopen_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, close_document_id)
);
CREATE INDEX year_close_runs_fiscal_year_id_idx ON finance.year_close_runs (organization_id, fiscal_year_id);
CREATE INDEX year_close_runs_close_document_id_idx ON finance.year_close_runs (organization_id, close_document_id);
CREATE INDEX year_close_runs_reopen_document_id_idx ON finance.year_close_runs (organization_id, reopen_document_id);
CREATE INDEX year_close_runs_created_by_member_id_idx ON finance.year_close_runs (organization_id, created_by_member_id);

-- Hardened membership/permission lookup. Keep finance_private outside exposed schemas.
CREATE FUNCTION finance_private.has_permission(p_organization_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr ON mr.organization_id = m.organization_id AND mr.member_id = m.id
    JOIN finance.role_permissions rp ON rp.organization_id = mr.organization_id AND rp.role_id = mr.role_id
    JOIN finance.permissions p ON p.id = rp.permission_id
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid() AND m.status = 'active' AND p.code = p_permission
  );
$$;
CREATE FUNCTION finance_private.can_read_document(p_organization_id uuid, p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id
      AND (
        finance_private.has_permission(d.organization_id, 'documents.read')
        OR (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance')
            AND finance_private.has_permission(d.organization_id, 'sales.read'))
        OR (d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense')
            AND finance_private.has_permission(d.organization_id, 'purchases.read'))
        OR (d.document_type = 'transfer' AND finance_private.has_permission(d.organization_id, 'banking.read'))
      )
  );
$$;
CREATE FUNCTION finance_private.can_read_attachment(p_organization_id uuid, p_attachment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM finance.attachment_links l
      WHERE l.organization_id = p_organization_id AND l.attachment_id = p_attachment_id
        AND finance_private.can_read_document(l.organization_id, l.document_id)
    ) OR EXISTS (
      SELECT 1 FROM finance.attachments a
      JOIN finance.organization_members m ON m.organization_id = a.organization_id AND m.id = a.uploaded_by_member_id
      WHERE a.organization_id = p_organization_id AND a.id = p_attachment_id
        AND m.user_id = auth.uid() AND m.status = 'active'
        AND finance_private.has_permission(a.organization_id, 'attachments.write')
    )
  );
$$;
REVOKE ALL ON FUNCTION finance_private.can_read_document(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance_private.can_read_attachment(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_document(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_attachment(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance_private.has_permission(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA finance, finance_private TO authenticated;
GRANT EXECUTE ON FUNCTION finance_private.has_permission(uuid,text) TO authenticated;
-- Read grants below are module-scoped. They do not authorize a financial mutation.
-- At deployment expose only the deliberate API surface, not finance_private.

ALTER TABLE finance.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.profiles TO authenticated;
CREATE POLICY profiles_read ON finance.profiles FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE finance.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.organizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.organizations TO authenticated;
CREATE POLICY organizations_read ON finance.organizations FOR SELECT TO authenticated USING (finance_private.has_permission(id, 'company.read'));
ALTER TABLE finance.organization_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.organization_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.organization_members TO authenticated;
CREATE POLICY organization_members_read ON finance.organization_members FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.permissions TO authenticated;
CREATE POLICY permissions_read ON finance.permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
ALTER TABLE finance.roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.roles TO authenticated;
CREATE POLICY roles_read ON finance.roles FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.role_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.role_permissions TO authenticated;
CREATE POLICY role_permissions_read ON finance.role_permissions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.member_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.member_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.member_roles TO authenticated;
CREATE POLICY member_roles_read ON finance.member_roles FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.invitations TO authenticated;
CREATE POLICY invitations_read ON finance.invitations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.fiscal_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.fiscal_years FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.fiscal_years TO authenticated;
CREATE POLICY fiscal_years_read ON finance.fiscal_years FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.accounting_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.accounting_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.accounting_periods TO authenticated;
CREATE POLICY accounting_periods_read ON finance.accounting_periods FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.accounts TO authenticated;
CREATE POLICY accounts_read ON finance.accounts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.account_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.account_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.account_mappings TO authenticated;
CREATE POLICY account_mappings_read ON finance.account_mappings FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.contacts TO authenticated;
CREATE POLICY contacts_read ON finance.contacts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'contacts.read') OR (is_customer AND finance_private.has_permission(organization_id, 'sales.read')) OR (is_vendor AND finance_private.has_permission(organization_id, 'purchases.read')));
ALTER TABLE finance.cost_centers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cost_centers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.cost_centers TO authenticated;
CREATE POLICY cost_centers_read ON finance.cost_centers FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.tax_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.tax_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.tax_codes TO authenticated;
CREATE POLICY tax_codes_read ON finance.tax_codes FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'tax.read'));
ALTER TABLE finance.items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.items TO authenticated;
CREATE POLICY items_read ON finance.items FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'catalog.read'));
ALTER TABLE finance.cash_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cash_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.cash_accounts TO authenticated;
CREATE POLICY cash_accounts_read ON finance.cash_accounts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.document_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_sequences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_sequences TO authenticated;
CREATE POLICY document_sequences_read ON finance.document_sequences FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.business_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.business_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.business_documents TO authenticated;
CREATE POLICY business_documents_read ON finance.business_documents FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, id));
ALTER TABLE finance.trade_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.trade_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.trade_documents TO authenticated;
CREATE POLICY trade_documents_read ON finance.trade_documents FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.document_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_lines TO authenticated;
CREATE POLICY document_lines_read ON finance.document_lines FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.money_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.money_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.money_movements TO authenticated;
CREATE POLICY money_movements_read ON finance.money_movements FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.transfers TO authenticated;
CREATE POLICY transfers_read ON finance.transfers FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.manual_journal_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.manual_journal_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.manual_journal_rows TO authenticated;
CREATE POLICY manual_journal_rows_read ON finance.manual_journal_rows FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.journal_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.journal_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.journal_entries TO authenticated;
CREATE POLICY journal_entries_read ON finance.journal_entries FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'ledger.read'));
ALTER TABLE finance.journal_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.journal_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.journal_lines TO authenticated;
CREATE POLICY journal_lines_read ON finance.journal_lines FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'ledger.read'));
ALTER TABLE finance.open_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.open_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.open_items TO authenticated;
CREATE POLICY open_items_read ON finance.open_items FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read') OR (control_kind IN ('ar','customer_advance') AND finance_private.has_permission(organization_id, 'sales.read')) OR (control_kind IN ('ap','vendor_advance') AND finance_private.has_permission(organization_id, 'purchases.read')));
ALTER TABLE finance.document_allocation_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_allocation_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_allocation_plans TO authenticated;
CREATE POLICY document_allocation_plans_read ON finance.document_allocation_plans FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.settlement_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.settlement_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.settlement_allocations TO authenticated;
CREATE POLICY settlement_allocations_read ON finance.settlement_allocations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read'));
ALTER TABLE finance.allocation_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.allocation_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.allocation_reversals TO authenticated;
CREATE POLICY allocation_reversals_read ON finance.allocation_reversals FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read'));
ALTER TABLE finance.bank_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.bank_imports TO authenticated;
CREATE POLICY bank_imports_read ON finance.bank_imports FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.statement_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.statement_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.statement_lines TO authenticated;
CREATE POLICY statement_lines_read ON finance.statement_lines FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.reconciliations TO authenticated;
CREATE POLICY reconciliations_read ON finance.reconciliations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.reconciliation_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliation_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.reconciliation_matches TO authenticated;
CREATE POLICY reconciliation_matches_read ON finance.reconciliation_matches FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.approval_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_policies TO authenticated;
CREATE POLICY approval_policies_read ON finance.approval_policies FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_requests TO authenticated;
CREATE POLICY approval_requests_read ON finance.approval_requests FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.approval_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_decisions TO authenticated;
CREATE POLICY approval_decisions_read ON finance.approval_decisions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.attachments TO authenticated;
CREATE POLICY attachments_read ON finance.attachments FOR SELECT TO authenticated USING (finance_private.can_read_attachment(organization_id, id));
ALTER TABLE finance.attachment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachment_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.attachment_links TO authenticated;
CREATE POLICY attachment_links_read ON finance.attachment_links FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.audit_events TO authenticated;
CREATE POLICY audit_events_read ON finance.audit_events FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'audit.read'));
ALTER TABLE finance.period_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.period_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.period_events TO authenticated;
CREATE POLICY period_events_read ON finance.period_events FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'audit.read'));
ALTER TABLE finance.import_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.import_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.import_jobs TO authenticated;
CREATE POLICY import_jobs_read ON finance.import_jobs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'imports.read'));
ALTER TABLE finance.import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.import_rows TO authenticated;
CREATE POLICY import_rows_read ON finance.import_rows FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'imports.read'));
ALTER TABLE finance.export_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.export_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.export_jobs TO authenticated;
CREATE POLICY export_jobs_read ON finance.export_jobs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'exports.read'));
ALTER TABLE finance.report_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.report_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.report_snapshots TO authenticated;
CREATE POLICY report_snapshots_read ON finance.report_snapshots FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'reports.read'));
ALTER TABLE finance.idempotency_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.idempotency_requests FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.outbox_events FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.notification_deliveries FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.plans TO authenticated;
CREATE POLICY plans_read ON finance.plans FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
ALTER TABLE finance.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.subscriptions TO authenticated;
CREATE POLICY subscriptions_read ON finance.subscriptions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'subscription.read'));
ALTER TABLE finance.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.billing_events FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.year_close_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.year_close_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.year_close_runs TO authenticated;
CREATE POLICY year_close_runs_read ON finance.year_close_runs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
CREATE UNIQUE INDEX year_one_live_close_idx ON finance.year_close_runs (organization_id, fiscal_year_id) WHERE reopen_document_id IS NULL;

-- No INSERT, UPDATE, DELETE, or TRUNCATE grant is issued to authenticated or anon.
-- Seed role templates through a trusted onboarding command; granting catalog reads
-- must not be confused with allowing users to grant themselves permissions.
-- IMPORTANT: row-local CHECKs do NOT enforce journal balance, posted immutability,
-- allocation capacities, period locks, or complete subledgers. See DB-G01..DB-G18.
-- Security-definer mutation routines require: auth.uid() verification, live membership,
-- exact action permission, explicit search_path, same-tenant references, actor derivation,
-- period/source/open-item locks, idempotency, audit/outbox and restricted EXECUTE.
COMMIT;
