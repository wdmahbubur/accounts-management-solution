CREATE TABLE finance_private.onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  owner_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (organization_id, owner_member_id)
    REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT
);

REVOKE ALL ON finance_private.onboarding_requests FROM PUBLIC, ams_runtime;

CREATE FUNCTION public.create_company_atomic(
  p_name text,
  p_legal_name text,
  p_country_code text,
  p_base_currency text,
  p_timezone text,
  p_fiscal_year_start_month smallint,
  p_books_start_date date,
  p_idempotency_key text
)
RETURNS TABLE (
  organization_id uuid,
  owner_member_id uuid,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := identity.current_actor_id();
  v_request jsonb;
  v_existing finance_private.onboarding_requests%ROWTYPE;
  v_org_id uuid := gen_random_uuid();
  v_member_id uuid := gen_random_uuid();
  v_owner_role_id uuid;
  v_owner_name text;
  v_slug_base text;
  v_slug text;
  v_fiscal_start date;
  v_fiscal_end date;
  v_fiscal_year_id uuid := gen_random_uuid();
  v_period_start date;
  v_period_end date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' OR char_length(btrim(p_name)) > 160 THEN
    RAISE EXCEPTION 'invalid company name' USING ERRCODE = '22023';
  END IF;

  IF p_legal_name IS NULL OR btrim(p_legal_name) = '' OR char_length(btrim(p_legal_name)) > 240 THEN
    RAISE EXCEPTION 'invalid legal name' USING ERRCODE = '22023';
  END IF;

  IF upper(coalesce(p_country_code, '')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid country code' USING ERRCODE = '22023';
  END IF;

  IF upper(coalesce(p_base_currency, '')) <> 'BDT' THEN
    RAISE EXCEPTION 'V1 supports BDT only' USING ERRCODE = '22023';
  END IF;

  IF p_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone
  ) THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  IF p_fiscal_year_start_month IS NULL
     OR p_fiscal_year_start_month < 1
     OR p_fiscal_year_start_month > 12 THEN
    RAISE EXCEPTION 'invalid fiscal year start month' USING ERRCODE = '22023';
  END IF;

  IF p_books_start_date IS NULL OR NOT isfinite(p_books_start_date) THEN
    RAISE EXCEPTION 'invalid books start date' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  v_request := jsonb_build_object(
    'name', btrim(p_name),
    'legal_name', btrim(p_legal_name),
    'country_code', upper(p_country_code),
    'base_currency', 'BDT',
    'timezone', p_timezone,
    'fiscal_year_start_month', p_fiscal_year_start_month,
    'books_start_date', p_books_start_date
  );

  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext(p_idempotency_key)
  );

  SELECT *
  INTO v_existing
  FROM finance_private.onboarding_requests r
  WHERE r.user_id = v_user_id
    AND r.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_payload <> v_request THEN
      RAISE EXCEPTION 'onboarding idempotency key reused with different request'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
    SELECT v_existing.organization_id, v_existing.owner_member_id, true;
    RETURN;
  END IF;

  SELECT COALESCE(
           NULLIF(btrim(p.display_name), ''),
           NULLIF(split_part(u.email, '@', 1), ''),
           'Owner'
         )
  INTO v_owner_name
  FROM identity.users u
  LEFT JOIN finance.profiles p ON p.user_id = u.id
  WHERE u.id = v_user_id;

  IF v_owner_name IS NULL THEN
    RAISE EXCEPTION 'verified user not found' USING ERRCODE = '28000';
  END IF;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  IF v_slug_base = '' THEN
    v_slug_base := 'company';
  END IF;
  v_slug := left(v_slug_base, 72) || '-' || left(replace(v_org_id::text, '-', ''), 8);

  IF extract(month from p_books_start_date)::int >= p_fiscal_year_start_month THEN
    v_fiscal_start := make_date(
      extract(year from p_books_start_date)::int,
      p_fiscal_year_start_month,
      1
    );
  ELSE
    v_fiscal_start := make_date(
      extract(year from p_books_start_date)::int - 1,
      p_fiscal_year_start_month,
      1
    );
  END IF;
  v_fiscal_end := (v_fiscal_start + interval '1 year - 1 day')::date;

  INSERT INTO finance.organizations (
    id, name, slug, legal_name, country_code, base_currency, timezone,
    books_start_date, fiscal_year_start_month, status
  )
  VALUES (
    v_org_id, btrim(p_name), v_slug, btrim(p_legal_name), upper(p_country_code),
    'BDT', p_timezone, p_books_start_date, p_fiscal_year_start_month, 'onboarding'
  );

  INSERT INTO finance.organization_members (
    id, organization_id, user_id, display_name_snapshot, status
  )
  VALUES (
    v_member_id, v_org_id, v_user_id, v_owner_name, 'active'
  );

  INSERT INTO finance.roles (
    organization_id, name, template_key, is_system
  )
  VALUES
    (v_org_id, 'Owner', 'owner', true),
    (v_org_id, 'Admin', 'admin', true),
    (v_org_id, 'Finance manager', 'finance_manager', true),
    (v_org_id, 'Accountant', 'accountant', true),
    (v_org_id, 'Billing', 'billing', true),
    (v_org_id, 'Auditor', 'auditor', true);

  SELECT r.id
  INTO v_owner_role_id
  FROM finance.roles r
  WHERE r.organization_id = v_org_id
    AND r.template_key = 'owner';

  INSERT INTO finance.member_roles (
    organization_id, member_id, role_id
  )
  VALUES (v_org_id, v_member_id, v_owner_role_id);

  INSERT INTO finance.accounts (
    organization_id, code, name, account_type, normal_side, report_group,
    control_kind, is_postable, is_active, is_system
  )
  VALUES
    (v_org_id,'1000','Cash on hand','asset','debit','cash',NULL,true,true,true),
    (v_org_id,'1010','Bank','asset','debit','cash',NULL,true,true,true),
    (v_org_id,'1020','Mobile wallet','asset','debit','cash',NULL,true,true,true),
    (v_org_id,'1030','Payment clearing','asset','debit','clearing',NULL,true,true,true),
    (v_org_id,'1100','Trade receivables','asset','debit','receivables','ar',true,true,true),
    (v_org_id,'1150','Supplier advances','asset','debit','advances','vendor_advance',true,true,true),
    (v_org_id,'1200','Recoverable input tax','asset','debit','tax',NULL,true,true,true),
    (v_org_id,'1300','Prepaid expenses','asset','debit','prepayments',NULL,true,true,true),
    (v_org_id,'1500','Equipment','asset','debit','fixed_assets',NULL,true,true,true),
    (v_org_id,'1590','Accumulated depreciation','asset','credit','fixed_assets',NULL,true,true,true),
    (v_org_id,'2000','Trade payables','liability','credit','payables','ap',true,true,true),
    (v_org_id,'2100','Output tax payable','liability','credit','tax',NULL,true,true,true),
    (v_org_id,'2200','Customer advances','liability','credit','advances','customer_advance',true,true,true),
    (v_org_id,'2250','Deferred revenue','liability','credit','deferred_revenue',NULL,true,true,true),
    (v_org_id,'2300','Loans payable','liability','credit','financing',NULL,true,true,true),
    (v_org_id,'3000','Owner/share capital','equity','credit','equity',NULL,true,true,true),
    (v_org_id,'3100','Retained earnings','equity','credit','equity',NULL,true,true,true),
    (v_org_id,'3200','Distributions/drawings','equity','debit','equity',NULL,true,true,true),
    (v_org_id,'3900','Opening suspense','equity','credit','equity',NULL,true,true,true),
    (v_org_id,'4000','Service revenue','income','credit','revenue',NULL,true,true,true),
    (v_org_id,'4090','Sales returns/allowances','income','debit','revenue',NULL,true,true,true),
    (v_org_id,'5000','Direct service costs','expense','debit','cost_of_sales',NULL,true,true,true),
    (v_org_id,'6000','Rent','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6100','Utilities','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6200','Salaries','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6300','Marketing','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6400','Bank charges','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6500','Bad debts','expense','debit','operating_expense',NULL,true,true,true),
    (v_org_id,'6600','Rounding difference','expense','debit','operating_expense',NULL,true,true,true);

  WITH mapping(mapping_key, account_code) AS (
    VALUES
      ('cash','1000'),
      ('bank','1010'),
      ('ar','1100'),
      ('vendor_advance','1150'),
      ('input_tax','1200'),
      ('ap','2000'),
      ('output_tax','2100'),
      ('customer_advance','2200'),
      ('retained_earnings','3100'),
      ('opening_suspense','3900'),
      ('rounding_difference','6600')
  )
  INSERT INTO finance.account_mappings (
    organization_id, mapping_key, account_id
  )
  SELECT v_org_id, mapping.mapping_key, a.id
  FROM mapping
  JOIN finance.accounts a
    ON a.organization_id = v_org_id
   AND a.code = mapping.account_code;

  INSERT INTO finance.fiscal_years (
    id, organization_id, label, starts_on, ends_on, status
  )
  VALUES (
    v_fiscal_year_id,
    v_org_id,
    'FY ' || extract(year from v_fiscal_start)::int::text ||
      CASE
        WHEN extract(year from v_fiscal_end)::int = extract(year from v_fiscal_start)::int
          THEN ''
        ELSE '/' || right(extract(year from v_fiscal_end)::int::text, 2)
      END,
    v_fiscal_start,
    v_fiscal_end,
    'open'
  );

  INSERT INTO finance.accounting_periods (
    organization_id, fiscal_year_id, label, kind, starts_on, ends_on, status
  )
  VALUES (
    v_org_id,
    NULL,
    'Opening ' || (p_books_start_date - 1)::text,
    'opening',
    p_books_start_date - 1,
    p_books_start_date - 1,
    'open'
  );

  v_period_start := p_books_start_date;
  WHILE v_period_start <= v_fiscal_end LOOP
    v_period_end := LEAST(
      (date_trunc('month', v_period_start::timestamp) + interval '1 month - 1 day')::date,
      v_fiscal_end
    );

    INSERT INTO finance.accounting_periods (
      organization_id, fiscal_year_id, label, kind, starts_on, ends_on, status
    )
    VALUES (
      v_org_id,
      v_fiscal_year_id,
      to_char(v_period_start, 'YYYY-MM'),
      'regular',
      v_period_start,
      v_period_end,
      'open'
    );

    v_period_start := v_period_end + 1;
  END LOOP;

  INSERT INTO finance_private.onboarding_requests (
    user_id, idempotency_key, request_payload, organization_id, owner_member_id
  )
  VALUES (
    v_user_id, p_idempotency_key, v_request, v_org_id, v_member_id
  );

  RETURN QUERY SELECT v_org_id, v_member_id, false;
END
$$;

REVOKE ALL ON FUNCTION public.create_company_atomic(
  text,text,text,text,text,smallint,date,text
) FROM PUBLIC, ams_runtime;

GRANT EXECUTE ON FUNCTION public.create_company_atomic(
  text,text,text,text,text,smallint,date,text
) TO ams_runtime;

COMMENT ON FUNCTION public.create_company_atomic(
  text,text,text,text,text,smallint,date,text
)
IS 'US-007 atomic company onboarding. Actor is identity.current_actor_id(); capability templates are completed by US-009.';
