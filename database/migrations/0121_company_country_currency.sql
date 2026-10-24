-- Owner-requested base-currency/country selectors. Existing BDT books are preserved.
CREATE TABLE finance_private.company_currencies(code text PRIMARY KEY CHECK(code ~ '^[A-Z]{3}$'));
INSERT INTO finance_private.company_currencies(code) VALUES ('AED'),('AFN'),('ALL'),('AMD'),('AOA'),('ARS'),('AUD'),('AWG'),('AZN'),('BAM'),('BBD'),('BDT'),('BMD'),('BND'),('BOB'),('BRL'),('BSD'),('BTN'),('BWP'),('BYN'),('BZD'),('CAD'),('CDF'),('CHF'),('CNY'),('COP'),('CRC'),('CUP'),('CVE'),('CZK'),('DKK'),('DOP'),('DZD'),('EGP'),('ERN'),('ETB'),('EUR'),('FJD'),('FKP'),('GBP'),('GEL'),('GHS'),('GIP'),('GMD'),('GTQ'),('GYD'),('HKD'),('HNL'),('HTG'),('HUF'),('IDR'),('ILS'),('INR'),('IRR'),('JMD'),('KES'),('KGS'),('KHR'),('KPW'),('KYD'),('KZT'),('LAK'),('LBP'),('LKR'),('LRD'),('LSL'),('MAD'),('MDL'),('MGA'),('MKD'),('MMK'),('MNT'),('MOP'),('MRU'),('MUR'),('MVR'),('MWK'),('MXN'),('MYR'),('MZN'),('NAD'),('NGN'),('NIO'),('NOK'),('NPR'),('NZD'),('PAB'),('PEN'),('PGK'),('PHP'),('PKR'),('PLN'),('QAR'),('RON'),('RSD'),('RUB'),('SAR'),('SBD'),('SCR'),('SDG'),('SEK'),('SGD'),('SHP'),('SLE'),('SOS'),('SRD'),('SSP'),('STN'),('SVC'),('SYP'),('SZL'),('THB'),('TJS'),('TMT'),('TOP'),('TRY'),('TTD'),('TWD'),('TZS'),('UAH'),('USD'),('UYU'),('UZS'),('VED'),('VES'),('WST'),('XCD'),('XCG'),('YER'),('ZAR'),('ZMW'),('ZWG');
ALTER TABLE finance_private.company_currencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.company_currencies FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE TABLE finance_private.company_countries(code text PRIMARY KEY CHECK(code ~ '^[A-Z]{2}$'));
INSERT INTO finance_private.company_countries(code) VALUES ('AD'),('AE'),('AF'),('AG'),('AI'),('AL'),('AM'),('AO'),('AQ'),('AR'),('AS'),('AT'),('AU'),('AW'),('AX'),('AZ'),('BA'),('BB'),('BD'),('BE'),('BF'),('BG'),('BH'),('BI'),('BJ'),('BL'),('BM'),('BN'),('BO'),('BQ'),('BR'),('BS'),('BT'),('BV'),('BW'),('BY'),('BZ'),('CA'),('CC'),('CD'),('CF'),('CG'),('CH'),('CI'),('CK'),('CL'),('CM'),('CN'),('CO'),('CR'),('CU'),('CV'),('CW'),('CX'),('CY'),('CZ'),('DE'),('DJ'),('DK'),('DM'),('DO'),('DZ'),('EC'),('EE'),('EG'),('EH'),('ER'),('ES'),('ET'),('FI'),('FJ'),('FK'),('FM'),('FO'),('FR'),('GA'),('GB'),('GD'),('GE'),('GF'),('GG'),('GH'),('GI'),('GL'),('GM'),('GN'),('GP'),('GQ'),('GR'),('GS'),('GT'),('GU'),('GW'),('GY'),('HK'),('HM'),('HN'),('HR'),('HT'),('HU'),('ID'),('IE'),('IL'),('IM'),('IN'),('IO'),('IQ'),('IR'),('IS'),('IT'),('JE'),('JM'),('JO'),('JP'),('KE'),('KG'),('KH'),('KI'),('KM'),('KN'),('KP'),('KR'),('KW'),('KY'),('KZ'),('LA'),('LB'),('LC'),('LI'),('LK'),('LR'),('LS'),('LT'),('LU'),('LV'),('LY'),('MA'),('MC'),('MD'),('ME'),('MF'),('MG'),('MH'),('MK'),('ML'),('MM'),('MN'),('MO'),('MP'),('MQ'),('MR'),('MS'),('MT'),('MU'),('MV'),('MW'),('MX'),('MY'),('MZ'),('NA'),('NC'),('NE'),('NF'),('NG'),('NI'),('NL'),('NO'),('NP'),('NR'),('NU'),('NZ'),('OM'),('PA'),('PE'),('PF'),('PG'),('PH'),('PK'),('PL'),('PM'),('PN'),('PR'),('PS'),('PT'),('PW'),('PY'),('QA'),('RE'),('RO'),('RS'),('RU'),('RW'),('SA'),('SB'),('SC'),('SD'),('SE'),('SG'),('SH'),('SI'),('SJ'),('SK'),('SL'),('SM'),('SN'),('SO'),('SR'),('SS'),('ST'),('SV'),('SX'),('SY'),('SZ'),('TC'),('TD'),('TF'),('TG'),('TH'),('TJ'),('TK'),('TL'),('TM'),('TN'),('TO'),('TR'),('TT'),('TV'),('TW'),('TZ'),('UA'),('UG'),('UM'),('US'),('UY'),('UZ'),('VA'),('VC'),('VE'),('VG'),('VI'),('VN'),('VU'),('WF'),('WS'),('YE'),('YT'),('ZA'),('ZM'),('ZW');
ALTER TABLE finance_private.company_countries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.company_countries FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE FUNCTION finance_private.valid_company_currency(p_currency text) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_currency IN ('AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CNY','COP','CRC','CUP','CVE','CZK','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IRR','JMD','KES','KGS','KHR','KPW','KYD','KZT','LAK','LBP','LKR','LRD','LSL','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','PAB','PEN','PGK','PHP','PKR','PLN','QAR','RON','RSD','RUB','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TOP','TRY','TTD','TWD','TZS','UAH','USD','UYU','UZS','VED','VES','WST','XCD','XCG','YER','ZAR','ZMW','ZWG');
$$;
REVOKE ALL ON FUNCTION finance_private.valid_company_currency(text) FROM PUBLIC,ams_runtime,ams_job_worker;
-- Pure preview uses this validated catalog without exposing private tenant state.
GRANT EXECUTE ON FUNCTION finance_private.valid_company_currency(text) TO ams_runtime;
CREATE FUNCTION finance_private.company_currency(p_org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT base_currency::text FROM finance.organizations WHERE id=p_org;
$$;
REVOKE ALL ON FUNCTION finance_private.company_currency(uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
ALTER TABLE finance.organizations DROP CONSTRAINT organizations_base_currency_check;
ALTER TABLE finance.organizations ADD CONSTRAINT organizations_base_currency_check CHECK(finance_private.valid_company_currency(base_currency::text));
ALTER TABLE finance.business_documents DROP CONSTRAINT business_documents_currency_check;
ALTER TABLE finance.business_documents ADD CONSTRAINT business_documents_currency_check CHECK(finance_private.valid_company_currency(currency::text));
CREATE FUNCTION finance_private.guard_company_currency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='organizations' THEN
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency OR NEW.country_code IS DISTINCT FROM OLD.country_code THEN
   RAISE EXCEPTION 'Create separate books to change country or accounting currency' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.currency::text IS DISTINCT FROM finance_private.company_currency(NEW.organization_id) THEN
   RAISE EXCEPTION 'Document currency must equal company accounting currency' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_company_currency() FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE TRIGGER company_currency_immutable BEFORE UPDATE ON finance.organizations FOR EACH ROW EXECUTE FUNCTION finance_private.guard_company_currency();
CREATE TRIGGER document_company_currency BEFORE INSERT OR UPDATE ON finance.business_documents FOR EACH ROW EXECUTE FUNCTION finance_private.guard_company_currency();
CREATE FUNCTION public.read_company_locale(p_organization_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance.organization_members WHERE organization_id=p_organization_id AND user_id=identity.current_actor_id() AND status='active') THEN
  RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 RETURN(SELECT jsonb_build_object('organization_id',id,'country_code',country_code,'base_currency',base_currency) FROM finance.organizations WHERE id=p_organization_id);
END $$;
REVOKE ALL ON FUNCTION public.read_company_locale(uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_company_locale(uuid) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.calculate_document_preview(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE l jsonb; q numeric; price numeric; rate numeric; base numeric; disc numeric;
  net numeric; tax numeric; gross numeric; percent numeric; x numeric;
  sum_base numeric:=0; sum_discount numeric:=0; sum_net numeric:=0;
  sum_tax numeric:=0; sum_gross numeric:=0; adjustment numeric:=0;
  r jsonb; result_lines jsonb:='[]';
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'expected preview object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('currency','lines','rounding'))
    OR NOT COALESCE(finance_private.valid_company_currency(p_input->>'currency'),false)
    OR jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid preview contract or currency' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_input->'lines') NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'expected 1 to 1000 lines' USING ERRCODE='22023';
  END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
    IF jsonb_typeof(l) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid line' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN
      ('quantity','unit_price','discount_amount','discount_percent','tax_rate','tax_mode'))
      OR COALESCE(l->>'tax_mode','') NOT IN ('inclusive','exclusive')
      OR (l?'discount_amount' AND l?'discount_percent') THEN
      RAISE EXCEPTION 'invalid line contract' USING ERRCODE='22023';
    END IF;
    q:=finance_private.calculation_decimal(l->'quantity');
    price:=finance_private.calculation_decimal(l->'unit_price');
    rate:=finance_private.calculation_decimal(l->'tax_rate');
    IF q<=0 OR rate>100 THEN RAISE EXCEPTION 'invalid quantity or rate' USING ERRCODE='22023'; END IF;
    base:=round(q*price,2); disc:=0;
    IF l?'discount_amount' THEN disc:=finance_private.calculation_decimal(l->'discount_amount',true); END IF;
    IF l?'discount_percent' THEN
      percent:=finance_private.calculation_decimal(l->'discount_percent');
      IF percent>100 THEN RAISE EXCEPTION 'invalid discount' USING ERRCODE='22023'; END IF;
      disc:=round(base*percent/100,2);
    END IF;
    IF disc<0 OR disc>base THEN RAISE EXCEPTION 'discount exceeds base' USING ERRCODE='22023'; END IF;
    x:=base-disc;
    IF l->>'tax_mode'='inclusive' THEN
      -- Integer-cent quotient avoids premature precision loss in numeric division.
      net:=div(2*x*100*100000000+(100000000+rate*1000000),2*(100000000+rate*1000000))/100;
      tax:=x-net; gross:=x;
    ELSE net:=x; tax:=round(net*rate/100,2); gross:=net+tax;
    END IF;
    IF greatest(base,disc,net,tax,gross)>=1000000000000000000 THEN
      RAISE EXCEPTION 'monetary overflow' USING ERRCODE='22003';
    END IF;
    result_lines:=result_lines||jsonb_build_array(jsonb_build_object(
      'base',base::numeric(20,2)::text,'discount',disc::numeric(20,2)::text,
      'net',net::numeric(20,2)::text,'tax',tax::numeric(20,2)::text,'gross',gross::numeric(20,2)::text));
    sum_base:=sum_base+base; sum_discount:=sum_discount+disc;
    sum_net:=sum_net+net; sum_tax:=sum_tax+tax; sum_gross:=sum_gross+gross;
  END LOOP;
  IF p_input?'rounding' THEN
    r:=p_input->'rounding';
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid rounding object' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('amount','reason','account_id'))
      OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string'
      OR length(btrim(COALESCE(r->>'reason','')))=0 OR length(r->>'reason')>500
      OR COALESCE(r->>'account_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'rounding requires explicit account and reason' USING ERRCODE='22023';
    END IF;
    adjustment:=finance_private.calculation_decimal(r->'amount',true);
    IF abs(adjustment)>0.05 THEN RAISE EXCEPTION 'rounding exceeds 0.05 in company currency' USING ERRCODE='22023'; END IF;
  END IF;
  IF sum_gross+adjustment<0 OR greatest(sum_base,sum_discount,sum_net,sum_tax,sum_gross,sum_gross+adjustment)>=1000000000000000000 THEN
    RAISE EXCEPTION 'invalid document total or overflow' USING ERRCODE='22003';
  END IF;
  RETURN jsonb_build_object('currency',p_input->>'currency','lines',result_lines,
    'base',sum_base::numeric(20,2)::text,'discount',sum_discount::numeric(20,2)::text,
    'net',sum_net::numeric(20,2)::text,'tax',sum_tax::numeric(20,2)::text,'gross',sum_gross::numeric(20,2)::text,
    'rounding_adjustment',adjustment::numeric(20,2)::text,'total',(sum_gross+adjustment)::numeric(20,2)::text);
END $function$;

CREATE OR REPLACE FUNCTION public.create_company_atomic(p_name text, p_legal_name text, p_country_code text, p_base_currency text, p_timezone text, p_fiscal_year_start_month smallint, p_books_start_date date, p_idempotency_key text)
 RETURNS TABLE(organization_id uuid, owner_member_id uuid, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  IF NOT EXISTS(SELECT 1 FROM finance_private.company_countries WHERE code=upper(coalesce(p_country_code,''))) THEN
    RAISE EXCEPTION 'invalid country code' USING ERRCODE = '22023';
  END IF;

  IF NOT finance_private.valid_company_currency(upper(coalesce(p_base_currency,''))) THEN
    RAISE EXCEPTION 'Unsupported company accounting currency' USING ERRCODE = '22023';
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
    'base_currency', upper(p_base_currency),
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
           NULLIF(split_part(u.email_normalized, '@', 1), ''),
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
    upper(p_base_currency), p_timezone, p_books_start_date, p_fiscal_year_start_month, 'onboarding'
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
$function$;

CREATE OR REPLACE FUNCTION finance_private.cash_document_posting_plan(p_organization_id uuid, p_document_id uuid)
 RETURNS TABLE(line_no integer, account_id uuid, party_id uuid, cost_center_id uuid, debit finance.amount, credit finance.amount, description text, cash_flow_class finance.cash_flow_class, creates_open_item boolean, open_item_due_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc finance.business_documents%ROWTYPE;
  v_movement finance.money_movements%ROWTYPE;
  v_transfer finance.transfers%ROWTYPE;
  v_cash uuid;
  v_destination uuid;
  v_control uuid;
  v_control_kind text;
  v_incoming boolean;
BEGIN
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE = 'P0002'; END IF;
  IF v_doc.document_type IN ('customer_refund','vendor_refund') THEN
    PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
  END IF;
  IF v_doc.currency::text IS DISTINCT FROM finance_private.company_currency(p_organization_id) OR v_doc.total_amount <= 0 THEN
    RAISE EXCEPTION 'cash source must have a positive company-currency total' USING ERRCODE = '23514';
  END IF;

  IF v_doc.document_type='advance_application' THEN
    PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
    RETURN QUERY SELECT row_number() OVER (ORDER BY x.ord)::integer,oi.account_id,v_doc.party_id,NULL::uuid,
      CASE WHEN oi.side='credit' THEN s.amount ELSE 0::finance.amount END,
      CASE WHEN oi.side='debit' THEN s.amount ELSE 0::finance.amount END,
      v_doc.description,NULL::finance.cash_flow_class,true,NULL::date
      FROM finance.linked_settlement_details s
      CROSS JOIN LATERAL (VALUES(s.source_open_item_id,1),(s.target_open_item_id,2)) x(id,ord)
      JOIN finance.open_items oi ON oi.organization_id=s.organization_id AND oi.id=x.id
      WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id;
  ELSIF v_doc.document_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    SELECT m.* INTO v_movement FROM finance.money_movements m
      WHERE m.organization_id = p_organization_id AND m.document_id = p_document_id;
    IF NOT FOUND OR v_movement.amount <> v_doc.total_amount THEN
      RAISE EXCEPTION 'cash movement must agree with source total' USING ERRCODE = '23514';
    END IF;
    SELECT ca.account_id INTO v_cash FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_movement.cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_cash IS NULL THEN RAISE EXCEPTION 'cash account is unavailable' USING ERRCODE = '23514'; END IF;

    v_control_kind := CASE
      WHEN v_doc.document_type IN ('receipt','customer_refund') THEN 'ar'
      WHEN v_doc.document_type IN ('vendor_payment','vendor_refund') THEN 'ap'
      WHEN v_doc.document_type = 'customer_advance' THEN 'customer_advance'
      ELSE 'vendor_advance' END;
    SELECT m.account_id INTO v_control FROM finance.account_mappings m
      JOIN finance.accounts a ON a.organization_id = m.organization_id AND a.id = m.account_id
      WHERE m.organization_id = p_organization_id AND m.mapping_key = v_control_kind
        AND a.is_active AND a.is_postable AND a.control_kind::text = v_control_kind;
    IF v_control IS NULL THEN RAISE EXCEPTION 'control-account mapping is required' USING ERRCODE = '23514'; END IF;
    IF v_doc.document_type IN ('customer_refund','vendor_refund') THEN
      SELECT oi.account_id,oi.control_kind INTO v_control,v_control_kind FROM finance.linked_settlement_details s
        JOIN finance.open_items oi ON oi.organization_id=s.organization_id AND oi.id=s.source_open_item_id
        WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id;
    END IF;
    -- Retain the posting command's existing AR prerequisite for customer advances.
    IF v_doc.document_type = 'customer_advance' AND NOT EXISTS (
      SELECT 1 FROM finance.account_mappings m JOIN finance.accounts a
        ON a.organization_id = m.organization_id AND a.id = m.account_id
      WHERE m.organization_id = p_organization_id AND m.mapping_key = 'ar'
        AND a.is_active AND a.is_postable AND a.control_kind = 'ar'
    ) THEN RAISE EXCEPTION 'AR mapping is required' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM finance.contacts c WHERE c.organization_id = p_organization_id
        AND c.id = v_doc.party_id AND c.is_active
        AND CASE WHEN v_control_kind IN ('ar','customer_advance') THEN c.is_customer ELSE c.is_vendor END
    ) THEN RAISE EXCEPTION 'party does not match the control-account type' USING ERRCODE = '23514'; END IF;
    IF v_doc.due_date IS NOT NULL AND (NOT isfinite(v_doc.due_date) OR v_doc.due_date < v_doc.accounting_date) THEN
      RAISE EXCEPTION 'open-item due date is invalid' USING ERRCODE = '22023';
    END IF;
    v_incoming := v_doc.document_type IN ('receipt','customer_advance','vendor_refund');
    RETURN QUERY SELECT 1, v_cash, NULL::uuid, NULL::uuid,
      CASE WHEN v_incoming THEN v_movement.amount ELSE 0::finance.amount END,
      CASE WHEN v_incoming THEN 0::finance.amount ELSE v_movement.amount END,
      v_doc.description, v_movement.cash_flow_class, false, NULL::date;
    RETURN QUERY SELECT 2, v_control, v_doc.party_id, NULL::uuid,
      CASE WHEN v_incoming THEN 0::finance.amount ELSE v_movement.amount END,
      CASE WHEN v_incoming THEN v_movement.amount ELSE 0::finance.amount END,
      v_doc.description, v_movement.cash_flow_class, true, v_doc.due_date;
  ELSIF v_doc.document_type = 'transfer' THEN
    SELECT t.* INTO v_transfer FROM finance.transfers t
      WHERE t.organization_id = p_organization_id AND t.document_id = p_document_id;
    IF NOT FOUND OR v_transfer.amount + v_transfer.fee_amount <> v_doc.total_amount THEN
      RAISE EXCEPTION 'transfer details must agree with the source total' USING ERRCODE = '23514';
    END IF;
    SELECT ca.account_id INTO v_destination FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_transfer.to_cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_destination IS NULL THEN RAISE EXCEPTION 'destination cash account is unavailable' USING ERRCODE = '23514'; END IF;
    SELECT ca.account_id INTO v_cash FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_transfer.from_cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_cash IS NULL THEN RAISE EXCEPTION 'source cash account is unavailable' USING ERRCODE = '23514'; END IF;
    IF v_transfer.fee_amount > 0 AND NOT EXISTS (
      SELECT 1 FROM finance.accounts a WHERE a.organization_id = p_organization_id
        AND a.id = v_transfer.fee_account_id AND a.is_active AND a.is_postable AND a.control_kind IS NULL
    ) THEN RAISE EXCEPTION 'transfer fee account is unavailable' USING ERRCODE = '23514'; END IF;
    RETURN QUERY SELECT 1, v_destination, NULL::uuid, NULL::uuid, v_transfer.amount, 0::finance.amount,
      v_doc.description, 'internal'::finance.cash_flow_class, false, NULL::date;
    IF v_transfer.fee_amount > 0 THEN
      RETURN QUERY SELECT 2, v_transfer.fee_account_id, NULL::uuid, NULL::uuid, v_transfer.fee_amount, 0::finance.amount,
        'Transfer fee'::text, 'operating'::finance.cash_flow_class, false, NULL::date;
    END IF;
    RETURN QUERY SELECT CASE WHEN v_transfer.fee_amount > 0 THEN 3 ELSE 2 END, v_cash, NULL::uuid, NULL::uuid,
      0::finance.amount, (v_transfer.amount + v_transfer.fee_amount)::finance.amount,
      v_doc.description, 'internal'::finance.cash_flow_class, false, NULL::date;
  ELSE
    RAISE EXCEPTION 'this source is not a cash document' USING ERRCODE = '22023';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION finance_private.cash_document_preview(p_organization_id uuid, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc finance.business_documents%ROWTYPE;
  v_lines jsonb;
  v_debit finance.amount;
  v_credit finance.amount;
  v_control uuid;
  v_plan record;
  v_allocated finance.amount := 0;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  SELECT jsonb_agg(jsonb_build_object(
      'line_no', p.line_no, 'account_id', p.account_id, 'account_code', a.code, 'account_name', a.name,
      'party_id', p.party_id, 'party_name', c.display_name, 'debit', p.debit::text, 'credit', p.credit::text,
      'description', p.description, 'cash_flow_class', p.cash_flow_class, 'creates_open_item', p.creates_open_item
    ) ORDER BY p.line_no), sum(p.debit)::finance.amount, sum(p.credit)::finance.amount,
    (array_agg(p.account_id) FILTER (WHERE p.creates_open_item))[1]
    INTO v_lines, v_debit, v_credit, v_control
    FROM finance_private.cash_document_posting_plan(p_organization_id, p_document_id) p
      JOIN finance.accounts a ON a.organization_id = p_organization_id AND a.id = p.account_id
      LEFT JOIN finance.contacts c ON c.organization_id = p_organization_id AND c.id = p.party_id;
  IF v_debit IS NULL OR v_debit <= 0 OR v_debit <> v_credit OR v_debit <> v_doc.total_amount THEN
    RAISE EXCEPTION 'cash posting plan must balance and agree with the source total' USING ERRCODE = '23514';
  END IF;
  FOR v_plan IN
    SELECT p.target_open_item_id, p.amount, oi.party_id, oi.account_id, oi.side,
      d.id AS target_document_id, d.document_number,
      finance_private.open_item_residual_as_of(p_organization_id, oi.id, v_doc.accounting_date) AS available
    FROM finance.document_allocation_plans p
      JOIN finance.open_items oi ON oi.organization_id = p.organization_id AND oi.id = p.target_open_item_id
      JOIN finance.journal_lines jl ON jl.organization_id = oi.organization_id AND jl.id = oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id = jl.organization_id AND je.id = jl.journal_entry_id
      JOIN finance.business_documents d ON d.organization_id = je.organization_id AND d.id = je.source_document_id
    WHERE p.organization_id = p_organization_id AND p.document_id = p_document_id ORDER BY p.target_open_item_id
  LOOP
    IF v_doc.document_type NOT IN ('receipt','vendor_payment') OR v_plan.party_id IS DISTINCT FROM v_doc.party_id
      OR v_plan.account_id IS DISTINCT FROM v_control OR v_plan.amount <= 0
      OR v_plan.side IS DISTINCT FROM (CASE WHEN v_doc.document_type = 'receipt' THEN 'debit' ELSE 'credit' END) THEN
      RAISE EXCEPTION 'settlement plan target is no longer compatible' USING ERRCODE = '23514';
    END IF;
    -- This existing helper checks every historical boundary; no allocation is inserted here.
    PERFORM finance_private.assert_open_item_allocation_capacity(
      p_organization_id, v_plan.target_open_item_id, v_plan.amount, v_doc.accounting_date
    );
    v_allocated := v_allocated + v_plan.amount;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'target_open_item_id', v_plan.target_open_item_id, 'amount', v_plan.amount::text,
      'document_number', CASE WHEN finance_private.can_read_document(p_organization_id, v_plan.target_document_id)
        THEN v_plan.document_number ELSE NULL END,
      'available_amount', v_plan.available::text
    ));
  END LOOP;
  IF v_allocated > v_doc.total_amount THEN
    RAISE EXCEPTION 'planned settlements exceed the payment amount' USING ERRCODE = '23P01';
  END IF;
  RETURN jsonb_build_object(
    'document_id', v_doc.id, 'document_version', v_doc.version, 'document_type', v_doc.document_type,
    'currency', finance_private.company_currency(p_organization_id), 'debit', v_debit::text, 'credit', v_credit::text, 'balanced', true, 'lines', v_lines,
    'allocations', v_allocations, 'allocated_amount', v_allocated::text,
    'unallocated_amount', CASE WHEN v_doc.document_type IN ('receipt','vendor_payment')
      THEN (v_doc.total_amount - v_allocated)::finance.amount::text ELSE NULL END
  );
END; $function$;

CREATE OR REPLACE FUNCTION finance_private.company_setup_readiness(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_org finance.organizations%ROWTYPE; v_missing text[]; v_checks jsonb; v_calendar boolean; v_opening boolean;
BEGIN
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  SELECT array_agg(required.key ORDER BY required.key) INTO v_missing
    FROM unnest(ARRAY['cash','bank','ar','vendor_advance','input_tax','ap','output_tax','customer_advance','retained_earnings','opening_suspense','rounding_difference']) required(key)
    LEFT JOIN finance.account_mappings m ON m.organization_id=p_organization_id AND m.mapping_key=required.key
    LEFT JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE a.id IS NULL OR NOT finance_private.validate_mapping_target(required.key,a);
  SELECT EXISTS(SELECT 1 FROM finance.fiscal_years f
    JOIN finance.accounting_periods p ON p.organization_id=f.organization_id AND p.fiscal_year_id=f.id AND p.kind='regular'
    WHERE f.organization_id=p_organization_id AND f.status='open' AND v_org.books_start_date BETWEEN f.starts_on AND f.ends_on
    GROUP BY f.id,f.ends_on
    HAVING min(p.starts_on)=v_org.books_start_date AND max(p.ends_on)=f.ends_on
      AND sum(p.ends_on-p.starts_on+1)=f.ends_on-v_org.books_start_date+1 AND bool_and(p.status='open')) INTO v_calendar;
  SELECT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening'
    AND p.starts_on=v_org.books_start_date-1 AND p.ends_on=p.starts_on AND p.status='open') INTO v_opening;
  v_checks:=jsonb_build_array(
    jsonb_build_object('code','company_profile','required',true,'ready',finance_private.valid_company_currency(v_org.base_currency::text) AND btrim(v_org.name)<>'' AND btrim(v_org.legal_name)<>''
      AND isfinite(v_org.books_start_date) AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name=v_org.timezone),
      'message','Company identity, accounting currency, timezone and books-start date are valid.'),
    jsonb_build_object('code','account_mappings','required',true,'ready',v_missing IS NULL,
      'message',CASE WHEN v_missing IS NULL THEN 'All required accounts and system mappings are ready.' ELSE 'Repair these account mappings: '||array_to_string(v_missing,', ')||'.' END),
    jsonb_build_object('code','fiscal_calendar','required',true,'ready',v_calendar,'message','The first fiscal year and its operating periods must be open and cover books start through year end.'),
    jsonb_build_object('code','opening_period','required',true,'ready',v_opening,'message','The opening period must be open on the day before books start.'),
    jsonb_build_object('code','cash_account','required',false,'ready',EXISTS(SELECT 1 FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
      WHERE ca.organization_id=p_organization_id AND ca.is_active AND a.is_active AND a.is_postable AND a.account_type='asset' AND a.control_kind IS NULL),
      'message','Set up a cash or bank account before recording receipts or payments.'),
    jsonb_build_object('code','invoice_policy','required',false,'ready',EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='invoice' AND p.is_active),
      'message','Configure an invoice approval policy before submitting invoices.'),
    jsonb_build_object('code','receipt_policy','required',false,'ready',EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='receipt' AND p.is_active),
      'message','Configure a receipt approval policy before submitting receipts.'),
    jsonb_build_object('code','purchase_policies','required',false,'ready',NOT EXISTS(SELECT 1 FROM unnest(ARRAY['bill','paid_expense','vendor_payment']) kind(value)
      WHERE NOT EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type::text=kind.value AND p.is_active)),
      'message','Configure bill, expense and supplier-payment policies before submitting purchases.')
  );
  RETURN jsonb_build_object('organization_id',v_org.id,'name',v_org.name,'status',v_org.status,'books_start_date',v_org.books_start_date,
    'cutover_date',v_org.books_start_date-1,'checks',v_checks,
    'zero_opening_available',NOT EXISTS(SELECT 1 FROM finance.journal_entries j WHERE j.organization_id=p_organization_id)
      AND NOT EXISTS(SELECT 1 FROM finance.open_items i WHERE i.organization_id=p_organization_id)
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.document_type='opening_balance' AND d.state<>'void'),
    'opening_documents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'version',d.version,'state',d.state,'description',d.description,
      'accounting_date',d.accounting_date,'total_amount',d.total_amount::text,'has_cutover_summary',s.document_id IS NOT NULL) ORDER BY d.created_at,d.id)
      FROM finance.business_documents d LEFT JOIN finance_private.opening_cutover_summaries s ON s.organization_id=d.organization_id AND s.document_id=d.id
      WHERE d.organization_id=p_organization_id AND d.document_type='opening_balance' AND d.state<>'void'),'[]'::jsonb),
    'completion',(SELECT jsonb_build_object('opening_mode',c.opening_mode,'opening_document_id',c.opening_document_id,'completed_at',c.completed_at)
      FROM finance_private.company_setup_completions c WHERE c.organization_id=p_organization_id));
END; $function$;

CREATE OR REPLACE FUNCTION finance_private.period_close_checklist(p_organization_id uuid, p_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_period finance.accounting_periods%ROWTYPE;v_data jsonb;
BEGIN
  SELECT * INTO v_period FROM finance.accounting_periods p
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  WITH pending AS (
    SELECT count(DISTINCT d.id)::integer AS n FROM finance.business_documents d
    LEFT JOIN finance.approval_requests ar ON ar.organization_id=d.organization_id AND ar.document_id=d.id AND ar.state='pending'
    WHERE d.organization_id=p_organization_id AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on
      AND (d.state='pending_approval' OR ar.id IS NOT NULL)
  ), drafts AS (
    SELECT count(*)::integer AS n FROM finance.business_documents d WHERE d.organization_id=p_organization_id
      AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on AND d.state='draft'
  ), bank AS (
    SELECT count(*)::integer AS n FROM finance.reconciliations r WHERE r.organization_id=p_organization_id
      AND r.state='draft' AND daterange(r.starts_on,r.ends_on,'[]') && daterange(v_period.starts_on,v_period.ends_on,'[]')
  ), control AS (
    SELECT count(*)::integer AS n FROM finance.account_mappings m
    JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id AND a.control_kind IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS ledger
      FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
        AND je.state='posted' AND je.accounting_date<=v_period.ends_on
      WHERE jl.organization_id=p_organization_id AND jl.account_id=m.account_id
    ) gl
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(CASE WHEN oi.side='debit' THEN 1 ELSE -1 END * finance_private.open_item_balance_at(p_organization_id,oi.id,v_period.ends_on,transaction_timestamp())),0)::numeric AS residual
      FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.control_kind=m.mapping_key
        AND oi.account_id=m.account_id AND oi.issue_date<=v_period.ends_on
    ) items
    WHERE m.organization_id=p_organization_id AND m.mapping_key IN ('ar','ap','customer_advance','vendor_advance')
      AND gl.ledger<>items.residual
  ), suspense AS (
    SELECT count(*)::integer AS n FROM finance.account_mappings m
    JOIN finance.journal_lines jl ON jl.organization_id=m.organization_id AND jl.account_id=m.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date<=v_period.ends_on
    WHERE m.organization_id=p_organization_id AND m.mapping_key LIKE '%suspense%'
    GROUP BY m.id HAVING sum(jl.debit-jl.credit)<>0
  ), cash AS (
    SELECT count(*)::integer AS n FROM finance.cash_accounts ca
    JOIN finance.journal_lines jl ON jl.organization_id=ca.organization_id AND jl.account_id=ca.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on AND NOT je.is_opening
    WHERE ca.organization_id=p_organization_id AND ca.is_cash_equivalent
      AND (jl.cash_flow_class IS NULL OR jl.cash_flow_class='unclassified' OR jl.cash_flow_class='opening'
        OR (jl.cash_flow_class='internal' AND NOT EXISTS(SELECT 1 FROM finance.transfers t JOIN finance.business_documents d
          ON d.organization_id=t.organization_id AND d.id=t.document_id AND d.id=je.source_document_id AND d.document_type='transfer'
          JOIN finance.cash_accounts f ON f.organization_id=t.organization_id AND f.id=t.from_cash_account_id AND f.is_cash_equivalent
          JOIN finance.cash_accounts z ON z.organization_id=t.organization_id AND z.id=t.to_cash_account_id AND z.is_cash_equivalent
          WHERE t.organization_id=p_organization_id)))
  ), tb AS (
    SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS difference FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE jl.organization_id=p_organization_id AND je.accounting_date<=v_period.ends_on
  ), tax AS (
    SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS net FROM finance.account_mappings m
    JOIN finance.journal_lines jl ON jl.organization_id=m.organization_id AND jl.account_id=m.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date<=v_period.ends_on
    WHERE m.organization_id=p_organization_id AND m.mapping_key IN ('input_tax','output_tax')
  ), checks AS (
    SELECT 'pending_approvals'::text code,(SELECT n FROM pending) AS issue_count,'Pending approvals remain in this period.'::text detail,true AS blocking
    UNION ALL SELECT 'draft_documents',(SELECT n FROM drafts),'Unposted drafts remain in this period.',true
    UNION ALL SELECT 'bank_reconciliations',(SELECT n FROM bank),'Bank reconciliation sessions intersecting this period are still open.',true
    UNION ALL SELECT 'control_tieouts',(SELECT n FROM control),'AR/AP/advance open items do not tie to their control-account balances.',true
    UNION ALL SELECT 'suspense',(SELECT count(*) FROM suspense),'A mapped suspense account has a non-zero period-end balance.',true
    UNION ALL SELECT 'cash_classification',(SELECT n FROM cash),'Cash-equivalent activity needs a valid cash-flow classification.',true
    UNION ALL SELECT 'trial_balance',CASE WHEN (SELECT difference FROM tb)=0 THEN 0 ELSE 1 END,'Posted trial balance is not balanced.',true
    UNION ALL SELECT 'tax_control_review',CASE WHEN (SELECT net FROM tax)=0 THEN 0 ELSE 1 END,
      'Mapped input/output tax controls net to '||finance_private.company_currency(p_organization_id)||' '||(SELECT net::text FROM tax)||'; review the approved filing scope.',false
  )
  SELECT jsonb_build_object('period_id',p_period_id,'starts_on',v_period.starts_on,'ends_on',v_period.ends_on,
    'passed',COALESCE(bool_and(issue_count=0 OR NOT blocking),true),'blocking_count',count(*) FILTER(WHERE issue_count>0 AND blocking),
    'checks',COALESCE(jsonb_agg(jsonb_build_object('code',code,'count',issue_count,'detail',detail,'blocking',blocking) ORDER BY code),'[]'::jsonb),
    'checked_at',transaction_timestamp()) INTO v_data FROM checks;
  RETURN v_data;
END $function$;

CREATE OR REPLACE FUNCTION finance_private.validate_linked_settlement(p_organization_id uuid, p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d finance.business_documents%ROWTYPE; s finance.linked_settlement_details%ROWTYPE;
  a finance.open_items%ROWTYPE; t finance.open_items%ROWTYPE; v_type finance.document_type;
BEGIN
  SELECT x.* INTO d FROM finance.business_documents x WHERE x.organization_id=p_organization_id AND x.id=p_document_id;
  SELECT x.* INTO s FROM finance.linked_settlement_details x WHERE x.organization_id=p_organization_id AND x.document_id=p_document_id;
  IF s.document_id IS NULL OR s.document_version<>d.version OR s.amount<>d.total_amount OR d.currency::text IS DISTINCT FROM finance_private.company_currency(p_organization_id) THEN
    RAISE EXCEPTION 'current linked eligible balance is required' USING ERRCODE='23514'; END IF;
  SELECT x.* INTO a FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.source_open_item_id;
  SELECT j.document_type INTO v_type FROM finance.business_documents j JOIN finance.journal_entries e
    ON e.organization_id=j.organization_id AND e.source_document_id=j.id
    JOIN finance.journal_lines l ON l.organization_id=e.organization_id AND l.journal_entry_id=e.id
    WHERE l.organization_id=p_organization_id AND l.id=a.journal_line_id AND j.state='posted' AND e.state='posted'
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=j.organization_id AND r.reversal_of_document_id=j.id);
  IF NOT EXISTS(SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries j
    ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE l.organization_id=p_organization_id AND l.id=a.journal_line_id AND finance_private.can_read_document(p_organization_id,j.source_document_id)) THEN
    RAISE EXCEPTION 'linked source unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type IS NULL OR a.party_id IS DISTINCT FROM d.party_id OR a.issue_date>d.accounting_date OR NOT EXISTS(
    SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=d.party_id AND c.is_active
      AND CASE WHEN a.control_kind IN ('ar','customer_advance') THEN c.is_customer ELSE c.is_vendor END
  ) THEN RAISE EXCEPTION 'linked source is unavailable' USING ERRCODE='23514'; END IF;
  IF d.document_type='advance_application' THEN
    IF NOT ((v_type IN ('customer_advance','opening_balance') AND a.control_kind='customer_advance' AND a.side='credit') OR
      (v_type IN ('vendor_advance','opening_balance') AND a.control_kind='vendor_advance' AND a.side='debit')) THEN
      RAISE EXCEPTION 'application requires a true advance' USING ERRCODE='23514'; END IF;
    SELECT x.* INTO t FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.target_open_item_id;
    IF t.id IS NULL OR t.party_id<>a.party_id OR t.issue_date>d.accounting_date OR
      t.control_kind<>(CASE WHEN a.control_kind='customer_advance' THEN 'ar' ELSE 'ap' END) OR
      t.side<>(CASE WHEN a.side='credit' THEN 'debit' ELSE 'credit' END) OR NOT EXISTS(
        SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries e ON e.organization_id=l.organization_id AND e.id=l.journal_entry_id
        JOIN finance.business_documents x ON x.organization_id=e.organization_id AND x.id=e.source_document_id
        WHERE l.organization_id=p_organization_id AND l.id=t.journal_line_id AND e.state='posted' AND x.state='posted'
          AND (x.document_type='opening_balance' OR x.document_type=CASE WHEN a.control_kind='customer_advance' THEN 'invoice'::finance.document_type ELSE 'bill'::finance.document_type END)
          AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=x.organization_id AND r.reversal_of_document_id=x.id)
      ) THEN RAISE EXCEPTION 'application requires a compatible posted invoice or bill' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries j
      ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
      WHERE l.organization_id=p_organization_id AND l.id=t.journal_line_id AND finance_private.can_read_document(p_organization_id,j.source_document_id)) THEN
      RAISE EXCEPTION 'linked target unavailable' USING ERRCODE='P0002'; END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,t.id,s.amount,d.accounting_date);
  ELSIF d.document_type='customer_refund' THEN
    IF s.target_open_item_id IS NOT NULL OR a.side<>'credit' OR NOT (
      (a.control_kind='customer_advance' AND v_type IN ('customer_advance','opening_balance')) OR
      (a.control_kind='ar' AND v_type IN ('customer_credit','receipt','opening_balance'))
    ) THEN RAISE EXCEPTION 'customer refund requires eligible customer credit or unused advance' USING ERRCODE='23514'; END IF;
  ELSIF d.document_type='vendor_refund' THEN
    IF s.target_open_item_id IS NOT NULL OR a.side<>'debit' OR NOT (
      (a.control_kind='vendor_advance' AND v_type IN ('vendor_advance','opening_balance')) OR
      (a.control_kind='ap' AND v_type IN ('vendor_credit','vendor_payment','opening_balance'))
    ) THEN RAISE EXCEPTION 'supplier refund requires eligible supplier credit or unused advance' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'invalid linked settlement type' USING ERRCODE='23514'; END IF;
  IF d.document_type IN ('customer_refund','vendor_refund') AND NOT EXISTS(
    SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=p_document_id
      AND length(btrim(COALESCE(m.reference,''))) BETWEEN 1 AND 160 AND m.method IN ('cash','bank_transfer','mobile_wallet','card','other')) THEN
    RAISE EXCEPTION 'refund payment evidence required' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE x.organization_id=p_organization_id AND x.id=a.account_id AND x.is_active AND x.is_postable)
    OR (t.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE x.organization_id=p_organization_id AND x.id=t.account_id AND x.is_active AND x.is_postable)) THEN
    RAISE EXCEPTION 'linked control account is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,a.id,s.amount,d.accounting_date);
END; $function$;

CREATE OR REPLACE FUNCTION finance_private.validate_posted_journal_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_org uuid; v_entry uuid; v_header finance.journal_entries%ROWTYPE; v_document finance.business_documents%ROWTYPE;
  v_count integer; v_debits finance.amount; v_credits finance.amount; v_period finance.accounting_periods%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN
    v_org:=COALESCE(NEW.organization_id,OLD.organization_id);v_entry:=COALESCE(NEW.id,OLD.id);
  ELSE
    v_org:=COALESCE(NEW.organization_id,OLD.organization_id);v_entry:=COALESCE(NEW.journal_entry_id,OLD.journal_entry_id);
  END IF;
  SELECT * INTO v_header FROM finance.journal_entries j WHERE j.organization_id=v_org AND j.id=v_entry;
  IF NOT FOUND OR v_header.state<>'posted' OR v_header.posted_at IS NULL THEN
    RAISE EXCEPTION 'a building or incomplete journal cannot commit' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=v_org AND d.id=v_header.source_document_id;
  IF NOT FOUND OR v_document.state<>'posted' OR v_document.accounting_date<>v_header.accounting_date OR v_document.currency::text IS DISTINCT FROM finance_private.company_currency(v_header.organization_id) THEN
    RAISE EXCEPTION 'posted journal must agree with a posted company-currency source' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=v_org AND p.id=v_header.period_id;
  IF NOT FOUND OR v_header.accounting_date NOT BETWEEN v_period.starts_on AND v_period.ends_on OR
     (v_period.kind='opening') IS DISTINCT FROM v_header.is_opening THEN
    RAISE EXCEPTION 'journal date does not belong to its period' USING ERRCODE='23514';
  END IF;
  SELECT count(*),COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount
    INTO v_count,v_debits,v_credits FROM finance.journal_lines l WHERE l.organization_id=v_org AND l.journal_entry_id=v_entry;
  IF v_count<2 OR v_debits<=0 OR v_debits<>v_credits OR v_debits<>v_document.total_amount THEN
    RAISE EXCEPTION 'posted journal must have at least two balanced positive lines that agree with the source total' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM finance.journal_entries j WHERE j.organization_id=v_org AND j.source_document_id=v_header.source_document_id AND j.state='posted')<>1 THEN
    RAISE EXCEPTION 'posted source must have exactly one journal' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.post_financial_document(p_organization_id uuid, p_document_id uuid, p_expected_version integer, p_request_id text, p_idempotency_key text, p_request_hash text)
 RETURNS TABLE(document_id uuid, document_number text, document_version integer, journal_entry_id uuid, state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_type finance.document_type; v_permission text; v_period_id uuid;
  v_year_id uuid; v_journal_id uuid; v_number text; v_hash text; v_existing_actor uuid; v_receipt jsonb; v_account_id uuid;
  v_ar uuid; v_ap uuid; v_customer_advance uuid; v_vendor_advance uuid; v_output_tax uuid; v_input_tax uuid; v_rounding uuid;
  v_cash_account uuid; v_total_debit finance.amount:=0; v_total_credit finance.amount:=0; v_base finance.amount:=0; v_line_no integer:=0;
  v_line record; v_movement finance.money_movements%ROWTYPE; v_transfer finance.transfers%ROWTYPE; v_trade finance.trade_documents%ROWTYPE;
  v_original finance.business_documents%ROWTYPE; v_original_trade finance.trade_documents%ROWTYPE; v_original_line finance.document_lines%ROWTYPE;
  v_request finance.approval_requests%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
  v_open_item_id uuid; v_alloc_id uuid; v_target finance.open_items%ROWTYPE; v_plan record; v_period finance.accounting_periods%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR
     length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid posting request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_document_id::text||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT d.document_type INTO v_type FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.post'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.post'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.post' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.post:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,
      (v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state'; RETURN;
  END IF;
  -- Resolve the date without locking the source, then lock organization/year/period before the document.
  SELECT d.accounting_date,d.fiscal_year_id INTO v_doc.accounting_date,v_year_id FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_period_id:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,v_type='opening_balance');
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.document_type<>v_type OR v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
  IF (v_period.kind='regular' AND v_doc.fiscal_year_id IS DISTINCT FROM v_period.fiscal_year_id) OR
     (v_period.kind='opening' AND v_type<>'opening_balance') THEN RAISE EXCEPTION 'source fiscal year does not match its accounting period' USING ERRCODE='23514'; END IF;
  IF v_doc.state='posted' THEN RAISE EXCEPTION 'source is already posted' USING ERRCODE='23505'; END IF;
  IF v_doc.state<>'approved' OR v_doc.currency::text IS DISTINCT FROM finance_private.company_currency(p_organization_id) THEN RAISE EXCEPTION 'source must be approved in company currency before posting' USING ERRCODE='P0001'; END IF;
  IF v_doc.total_amount<=0 THEN RAISE EXCEPTION 'zero-value financial sources cannot post' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
    AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest THEN
    RAISE EXCEPTION 'approved source version or digest is stale' USING ERRCODE='40001';
  END IF;
  IF v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN RAISE EXCEPTION 'approval policy snapshot is incomplete' USING ERRCODE='40001'; END IF;
  IF v_request.policy_snapshot->>'approval_required'='true' THEN
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
      AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
    IF NOT FOUND OR NOT v_policy.is_active OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR
       v_policy.document_type<>v_type OR v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR
       v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR
       v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
       v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean OR
       NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
         WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'approval policy snapshot is stale or incomplete' USING ERRCODE='40001';
    END IF;
    PERFORM m.id FROM finance.approval_decisions ad JOIN finance.organization_members m
      ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
      JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
      JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
      JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
      WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve' AND m.status='active'
      ORDER BY m.id FOR KEY SHARE OF m,mr,rp;
    IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad
        JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
        JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
        JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
        JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
        WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
      RAISE EXCEPTION 'current eligible approvals no longer meet the policy requirement' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
        AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
       (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
        NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
      RAISE EXCEPTION 'sole-operator approval exception is no longer valid' USING ERRCODE='40001';
    END IF;
  END IF;
  IF v_type IN ('customer_credit','vendor_credit') THEN
    PERFORM finance_private.assert_credit_note_capacity(p_organization_id,p_document_id);
  END IF;
  SELECT m.account_id INTO v_ar FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ar' AND a.is_active AND a.is_postable AND a.control_kind='ar';
  SELECT m.account_id INTO v_ap FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ap' AND a.is_active AND a.is_postable AND a.control_kind='ap';
  SELECT m.account_id INTO v_customer_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='customer_advance' AND a.is_active AND a.is_postable AND a.control_kind='customer_advance';
  SELECT m.account_id INTO v_vendor_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='vendor_advance' AND a.is_active AND a.is_postable AND a.control_kind='vendor_advance';
  SELECT m.account_id INTO v_output_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='output_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_input_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='input_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_rounding FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='rounding_difference' AND a.is_active AND a.is_postable;
  IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND v_ar IS NULL THEN RAISE EXCEPTION 'AR mapping is required' USING ERRCODE='23514'; END IF;
  IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund') AND v_ap IS NULL THEN RAISE EXCEPTION 'AP mapping is required' USING ERRCODE='23514'; END IF;
  -- Lock all planned source balances before the document sequence row, following the shared lock order.
  IF EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id) THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  END IF;
  PERFORM oi.id FROM finance.open_items oi JOIN finance.document_allocation_plans p
    ON p.organization_id=oi.organization_id AND p.target_open_item_id=oi.id
    WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id FOR UPDATE OF oi;
  PERFORM oi.id FROM finance.open_items oi JOIN finance.linked_settlement_details s
    ON s.organization_id=oi.organization_id AND oi.id IN (s.source_open_item_id,s.target_open_item_id)
    WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id ORDER BY oi.id FOR UPDATE OF oi;
  IF v_type IN ('advance_application','customer_refund','vendor_refund') THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
    PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
  END IF;
  v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
  INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
    VALUES(p_organization_id,p_document_id,v_period_id,v_doc.accounting_date,'building',v_type='opening_balance',v_actor) RETURNING id INTO v_journal_id;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    SELECT * INTO v_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=p_document_id;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id) THEN
      RAISE EXCEPTION 'trade source requires typed details and lines' USING ERRCODE='23514'; END IF;
    IF v_type='invoice' THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
      IF v_trade.recognition_mode='deferred_revenue' THEN
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='2250' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'deferred revenue account is unavailable' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,NULL,0,v_doc.net_amount,v_doc.description,NULL);
        IF v_doc.tax_amount>0 THEN
          IF v_output_tax IS NULL THEN RAISE EXCEPTION 'output tax mapping is required' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_output_tax,NULL,NULL,0,v_doc.tax_amount,'Output tax',NULL);
        END IF;
      ELSE
        IF NOT v_trade.performance_confirmed THEN RAISE EXCEPTION 'earned invoice requires service performance confirmation' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
            AND a.account_type='income' AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
            RAISE EXCEPTION 'invoice lines require active income accounts' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,0,v_line.net_amount,v_line.description,v_line.cash_flow_class);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_output_tax),NULL,NULL,0,v_line.tax_amount,'Output tax · '||v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'invoice rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
        ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
      END IF;
    ELSIF v_type='bill' OR v_type='paid_expense' THEN
      FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
        IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
          AND a.account_type IN ('expense','asset') AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
          RAISE EXCEPTION 'bill and expense lines require active expense or asset accounts' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,
          CASE WHEN v_line.tax_recoverability_snapshot='full' THEN v_line.net_amount ELSE v_line.gross_amount END,0,v_line.description,v_line.cash_flow_class);
        IF v_line.tax_amount>0 AND v_line.tax_recoverability_snapshot='full' THEN
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_input_tax),NULL,NULL,v_line.tax_amount,0,'Recoverable input tax · '||v_line.description,NULL);
        END IF;
      END LOOP;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'expense rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='bill' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
      IF v_type='bill' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
      ELSE
        SELECT mm.amount,ca.account_id INTO v_movement.amount,v_cash_account FROM finance.money_movements mm JOIN finance.cash_accounts ca
          ON ca.organization_id=mm.organization_id AND ca.id=mm.cash_account_id AND ca.is_active WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
        IF v_cash_account IS NULL OR v_movement.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'cash movement must agree with the paid expense total' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_doc.total_amount,v_doc.description,'operating');
      END IF;
    ELSIF v_type IN ('customer_credit','vendor_credit') THEN
      IF v_trade.original_document_id IS NULL THEN RAISE EXCEPTION 'credit must reference its posted source document' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_trade.original_document_id FOR SHARE;
      IF NOT FOUND OR v_original.state<>'posted' OR v_original.party_id IS DISTINCT FROM v_doc.party_id OR
         (v_type='customer_credit' AND v_original.document_type<>'invoice') OR (v_type='vendor_credit' AND v_original.document_type<>'bill') THEN
        RAISE EXCEPTION 'credit source is not eligible for this party and document type' USING ERRCODE='23514';
      END IF;
      SELECT * INTO v_original_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=v_original.id;
      IF v_type='customer_credit' AND v_original_trade.recognition_mode='deferred_revenue' THEN
        RAISE EXCEPTION 'deferred-revenue credits require a separately allocated earned/unearned basis' USING ERRCODE='23514';
      END IF;
      IF v_type='customer_credit' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='4090' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'sales return account is unavailable' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,v_original_line.cost_center_id,v_line.net_amount,0,v_line.description,NULL);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_output_tax),NULL,NULL,v_line.tax_amount,0,'Tax reversal · '||v_line.description,NULL);
          END IF;
        END LOOP;
      ELSE
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          IF v_original_line.tax_recoverability_snapshot='full' THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.net_amount,v_line.description,NULL);
            IF v_line.tax_amount>0 THEN v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_input_tax),NULL,NULL,0,v_line.tax_amount,'Input tax reversal · '||v_line.description,NULL); END IF;
          ELSE
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.gross_amount,v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'credit rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='customer_credit' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','transfer') THEN
    -- Preview and posting use this one ordered cash-accounting plan. All writing,
    -- account locks, open-item creation and settlement checks remain in this command.
    FOR v_line IN SELECT p.* FROM finance_private.cash_document_posting_plan(p_organization_id,p_document_id) p ORDER BY p.line_no LOOP
      v_line_no:=v_line_no+1;
      PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,
        v_line.account_id,v_line.party_id,v_line.cost_center_id,v_line.debit,v_line.credit,v_line.description,v_line.cash_flow_class,
        CASE WHEN v_line.creates_open_item THEN v_number ELSE NULL END,v_line.open_item_due_date);
      IF v_line.creates_open_item AND v_type='receipt' THEN v_ar:=v_line.account_id; END IF;
      IF v_line.creates_open_item AND v_type='vendor_payment' THEN v_ap:=v_line.account_id; END IF;
    END LOOP;
    IF v_type IN ('receipt','vendor_payment') THEN
      SELECT mm.* INTO v_movement FROM finance.money_movements mm WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
      FOR v_line IN SELECT oi.id,oi.side,p.amount FROM finance.document_allocation_plans p JOIN finance.open_items oi
        ON oi.organization_id=p.organization_id AND oi.id=p.target_open_item_id WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id LOOP
        SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_target.party_id IS DISTINCT FROM v_doc.party_id OR v_target.account_id IS DISTINCT FROM (CASE WHEN v_type='receipt' THEN v_ar ELSE v_ap END) OR
           v_target.side IS DISTINCT FROM (CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END) OR v_line.amount<=0 OR v_line.amount>v_movement.amount THEN
          RAISE EXCEPTION 'settlement plan target is no longer compatible' USING ERRCODE='23514';
        END IF;
        SELECT oi.id INTO v_open_item_id FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
          WHERE jl.organization_id=p_organization_id AND jl.journal_entry_id=v_journal_id AND oi.id<>v_target.id ORDER BY oi.id LIMIT 1;
        IF v_open_item_id IS NULL THEN RAISE EXCEPTION 'new settlement control item unavailable' USING ERRCODE='23514'; END IF;
        -- The new opposite item is found from this journal's control line; references cannot cross organizations.
        IF v_target.side='debit' THEN
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_target.id,v_open_item_id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        ELSE
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_open_item_id,v_target.id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        END IF;
        PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.created','settlement_allocation',v_alloc_id,p_request_id,
          jsonb_build_object('amount',v_line.amount::text,'effective_date',v_doc.accounting_date,'source_document_id',p_document_id,
            'target_open_item_id',v_target.id,'settlement_open_item_id',v_open_item_id));
      END LOOP;
    END IF;
  ELSIF v_type='advance_application' THEN
    PERFORM finance_private.post_linked_settlement(p_organization_id,p_document_id,v_journal_id,v_number,v_actor,p_request_id);
  ELSIF v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    FOR v_line IN SELECT r.* FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id ORDER BY r.line_no LOOP
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,
        v_line.debit,v_line.credit,v_line.description,v_line.cash_flow_class,
        CASE WHEN EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id AND a.control_kind IS NOT NULL)
          THEN COALESCE(v_line.open_item_reference,v_number) ELSE v_line.open_item_reference END,v_line.open_item_due_date);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'this source type requires a dedicated controlled posting command' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('customer_refund','vendor_refund') THEN
    PERFORM finance_private.post_linked_settlement(p_organization_id,p_document_id,v_journal_id,v_number,v_actor,p_request_id);
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit
    FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal_id;
  IF v_total_debit<=0 OR v_total_debit<>v_total_credit THEN RAISE EXCEPTION 'journal is unbalanced' USING ERRCODE='23514'; END IF;
  UPDATE finance.journal_entries j SET state='posted',posted_at=clock_timestamp() WHERE j.organization_id=p_organization_id AND j.id=v_journal_id;
  UPDATE finance.business_documents d SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  SELECT jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal_id,'state','posted') INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.post:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.post','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'document_number',v_number,'journal_entry_id',v_journal_id,'debit_total',v_total_debit::text,'credit_total',v_total_credit::text));
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
    jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal_id));
  RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal_id,'posted'::text;
END; $function$;

CREATE OR REPLACE FUNCTION public.post_write_off_document(p_organization_id uuid, p_document_id uuid, p_expected_version integer, p_request_id text, p_idempotency_key text, p_request_hash text)
 RETURNS TABLE(document_id uuid, document_number text, document_version integer, journal_entry_id uuid, state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_detail finance.write_off_details%ROWTYPE; v_target finance.open_items%ROWTYPE;
 v_period uuid; v_period_row finance.accounting_periods%ROWTYPE; v_request finance.approval_requests%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
 v_hash text; v_owner uuid; v_receipt jsonb; v_number text; v_journal uuid; v_expense_line uuid; v_control_line uuid; v_credit_item uuid; v_debits finance.amount; v_credits finance.amount;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);
 IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid write-off posting request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_document_id::text||':'||p_idempotency_key,0));
 IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
 v_actor:=finance_private.require_capability(p_organization_id,'dues.adjust');
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_owner,v_receipt FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='documents.post:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_hash<>p_request_hash OR v_owner<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,(v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state'; RETURN;
 END IF;
 SELECT d.accounting_date INTO v_doc.accounting_date FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
 v_period:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,false);
 SELECT * INTO v_period_row FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period;
 SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
 IF v_doc.document_type<>'write_off' OR v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
 IF v_period_row.kind<>'regular' OR v_doc.fiscal_year_id IS DISTINCT FROM v_period_row.fiscal_year_id THEN RAISE EXCEPTION 'source fiscal year does not match its accounting period' USING ERRCODE='23514'; END IF;
 IF v_doc.state<>'approved' OR v_doc.currency::text IS DISTINCT FROM finance_private.company_currency(p_organization_id) OR v_doc.total_amount<=0 THEN RAISE EXCEPTION 'write-off must be approved and positive in company currency' USING ERRCODE='P0001'; END IF;
 SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
  AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest OR v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN
  RAISE EXCEPTION 'approved source version or digest is stale' USING ERRCODE='40001'; END IF;
 IF v_request.policy_snapshot->>'approval_required'='true' THEN
  SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
  IF NOT FOUND OR NOT v_policy.is_active OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR v_policy.document_type<>'write_off' OR
   v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
   v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean THEN RAISE EXCEPTION 'approval policy snapshot is stale' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
   WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN RAISE EXCEPTION 'approval role no longer has decision capability' USING ERRCODE='40001'; END IF;
  IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
    JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
    WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
   RAISE EXCEPTION 'current approvals no longer meet policy' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
    AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
    (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
     NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
   RAISE EXCEPTION 'sole-operator approval exception is no longer valid' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT * INTO v_detail FROM finance.write_off_details x WHERE x.organization_id=p_organization_id AND x.document_id=p_document_id;
 IF NOT FOUND OR v_detail.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'write-off details do not match source total' USING ERRCODE='23514'; END IF;
 PERFORM oi.id FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_detail.target_open_item_id FOR UPDATE;
 SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_detail.target_open_item_id;
 IF v_target.control_kind<>'ar' OR v_target.side<>'debit' OR v_target.party_id<>v_doc.party_id OR v_target.issue_date>v_doc.accounting_date OR
  finance_private.open_item_balance_at(p_organization_id,v_target.id,v_doc.accounting_date,clock_timestamp())<v_detail.amount THEN
  RAISE EXCEPTION 'receivable capacity or party changed after approval' USING ERRCODE='23P01'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_detail.expense_account_id AND a.account_type='expense' AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
  RAISE EXCEPTION 'write-off expense account is unavailable' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id)<>2 THEN
  RAISE EXCEPTION 'write-off source lines are incomplete' USING ERRCODE='23514'; END IF;
 v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
 INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
  VALUES(p_organization_id,p_document_id,v_period,v_doc.accounting_date,'building',false,v_actor) RETURNING id INTO v_journal;
 v_expense_line:=finance_private.insert_posting_line(p_organization_id,v_journal,1,v_detail.expense_account_id,NULL,NULL,v_detail.amount,0,v_detail.reason,'operating');
 v_control_line:=finance_private.insert_posting_line(p_organization_id,v_journal,2,v_target.account_id,v_target.party_id,NULL,0,v_detail.amount,v_detail.reason,'operating',v_target.reference);
 SELECT oi.id INTO v_credit_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_control_line;
 PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_detail.amount,v_doc.accounting_date);
 PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_credit_item,v_detail.amount,v_doc.accounting_date);
 INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
  VALUES(p_organization_id,v_target.id,v_credit_item,v_detail.amount,v_doc.accounting_date,v_actor,p_document_id);
 SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_debits,v_credits FROM finance.journal_lines l
  WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal;
 IF v_debits<>v_credits OR v_debits<>v_doc.total_amount THEN RAISE EXCEPTION 'write-off journal is not balanced to source' USING ERRCODE='23514'; END IF;
 UPDATE finance.journal_entries SET state='posted',posted_at=clock_timestamp() WHERE organization_id=p_organization_id AND id=v_journal;
 UPDATE finance.business_documents SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization_id AND id=p_document_id;
 v_receipt:=jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal,'state','posted');
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
  VALUES(p_organization_id,'documents.post:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'write_off.post','business_document',p_document_id,p_request_id,
  jsonb_build_object('version',v_doc.version,'document_number',v_number,'journal_entry_id',v_journal,'amount',v_detail.amount::text,'target_open_item_id',v_target.id,'settlement_open_item_id',v_credit_item,'reason',v_detail.reason));
 PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
  jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal));
 RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal,'posted'::text;
END; $function$;

CREATE OR REPLACE FUNCTION public.read_party_statement_snapshot(p_organization_id uuid, p_scope text, p_party_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_contact finance.contacts%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_trade text;v_advance text;v_control uuid;v_advance_account uuid;v_side text;v_data jsonb;v_org finance.organizations%ROWTYPE;
BEGIN
  IF p_scope NOT IN ('customer','vendor') OR p_party_id IS NULL OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN
    RAISE EXCEPTION 'invalid party statement filters' USING ERRCODE='22023'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'dues.read') AND NOT finance_private.has_permission(p_organization_id,CASE p_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id
    AND CASE p_scope WHEN 'customer' THEN c.is_customer ELSE c.is_vendor END;
  IF NOT FOUND THEN RAISE EXCEPTION 'party unavailable' USING ERRCODE='P0002'; END IF;
  v_trade:=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END;
  v_advance:=CASE p_scope WHEN 'customer' THEN 'customer_advance' ELSE 'vendor_advance' END;
  v_side:=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END;
  SELECT m.account_id INTO v_control FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_trade;
  SELECT m.account_id INTO v_advance_account FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_advance;
  IF v_control IS NULL OR v_advance_account IS NULL THEN RAISE EXCEPTION 'party control mapping unavailable' USING ERRCODE='P0002'; END IF;
  WITH item_base AS (
    SELECT oi.id,oi.journal_line_id,je.source_document_id,d.document_number,d.document_type::text AS document_type,oi.control_kind,oi.side,oi.reference,
      oi.issue_date,oi.due_date,oi.original_amount::numeric AS original_amount,
      CASE WHEN (oi.control_kind=v_trade AND oi.side=v_side) OR (oi.control_kind=v_advance AND oi.side=CASE p_scope WHEN 'customer' THEN 'credit' ELSE 'debit' END)
        THEN oi.original_amount::numeric ELSE -oi.original_amount::numeric END AS balance_effect
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.posted_at<=v_now
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE oi.organization_id=p_organization_id AND oi.party_id=p_party_id AND oi.control_kind IN (v_trade,v_advance) AND oi.created_at<=v_now
  ), openings AS (
    SELECT kind,COALESCE(sum(finance_private.open_item_balance_at(p_organization_id,i.id,p_from-1,v_now)*
      CASE WHEN i.balance_effect>0 THEN 1 ELSE -1 END),0)::numeric AS amount
    FROM (VALUES(v_trade),(v_advance)) kinds(kind) LEFT JOIN item_base i ON i.control_kind=kinds.kind GROUP BY kind
  ), closings AS (
    SELECT kind,COALESCE(sum(finance_private.open_item_balance_at(p_organization_id,i.id,p_to,v_now)*
      CASE WHEN i.balance_effect>0 THEN 1 ELSE -1 END),0)::numeric AS amount
    FROM (VALUES(v_trade),(v_advance)) kinds(kind) LEFT JOIN item_base i ON i.control_kind=kinds.kind GROUP BY kind
  ), source_events AS (
    SELECT i.id AS event_id,i.issue_date AS event_date,'source'::text AS event_type,i.control_kind,
      i.document_type,i.source_document_id,i.document_number,i.reference,NULL::uuid AS related_document_id,NULL::text AS related_document,NULL::text AS detail,
      i.balance_effect AS balance_effect
    FROM item_base i WHERE i.issue_date BETWEEN p_from AND p_to
  ), allocation_events AS (
    SELECT a.id AS event_id,a.effective_date AS event_date,'allocation'::text AS event_type,ditem.control_kind,
      'allocation'::text AS document_type,COALESCE(a.source_document_id,credit_doc.id) AS source_document_id,COALESCE(source.document_number,credit_doc.document_number) AS document_number,
      COALESCE(source.document_number,ditem.reference) AS reference,other_doc.id AS related_document_id,other_doc.document_number AS related_document,
      'Applied '||finance_private.company_currency(p_organization_id)||' '||a.amount::text AS detail,0::numeric AS balance_effect
    FROM finance.settlement_allocations a
    JOIN finance.open_items ditem ON ditem.organization_id=a.organization_id AND ditem.id=a.debit_open_item_id AND ditem.organization_id=p_organization_id AND ditem.party_id=p_party_id
    JOIN finance.open_items citem ON citem.organization_id=a.organization_id AND citem.id=a.credit_open_item_id
    JOIN finance.business_documents debit_doc ON debit_doc.organization_id=ditem.organization_id
      AND debit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=ditem.organization_id AND jl.id=ditem.journal_line_id)
    JOIN finance.business_documents credit_doc ON credit_doc.organization_id=citem.organization_id
      AND credit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)
    JOIN finance.business_documents other_doc ON other_doc.organization_id=a.organization_id
      AND other_doc.id=CASE WHEN a.source_document_id=debit_doc.id THEN credit_doc.id ELSE debit_doc.id END
    LEFT JOIN finance.business_documents source ON source.organization_id=a.organization_id AND source.id=a.source_document_id
    WHERE a.organization_id=p_organization_id AND ditem.control_kind IN (v_trade,v_advance) AND citem.party_id=p_party_id AND a.created_at<=v_now AND a.effective_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.id,r.effective_date,'allocation_reversal',ditem.control_kind,'allocation_reversal'::text,
      COALESCE(a.source_document_id,credit_doc.id),COALESCE(source.document_number,credit_doc.document_number),ditem.reference,other_doc.id,other_doc.document_number,r.reason,0::numeric
    FROM finance.allocation_reversals r JOIN finance.settlement_allocations a ON a.organization_id=r.organization_id AND a.id=r.allocation_id
    JOIN finance.open_items ditem ON ditem.organization_id=a.organization_id AND ditem.id=a.debit_open_item_id AND ditem.organization_id=p_organization_id AND ditem.party_id=p_party_id
    JOIN finance.open_items citem ON citem.organization_id=a.organization_id AND citem.id=a.credit_open_item_id
    JOIN finance.business_documents debit_doc ON debit_doc.organization_id=ditem.organization_id
      AND debit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=ditem.organization_id AND jl.id=ditem.journal_line_id)
    JOIN finance.business_documents credit_doc ON credit_doc.organization_id=citem.organization_id
      AND credit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)
    JOIN finance.business_documents other_doc ON other_doc.organization_id=a.organization_id
      AND other_doc.id=CASE WHEN a.source_document_id=debit_doc.id THEN credit_doc.id ELSE debit_doc.id END
    LEFT JOIN finance.business_documents source ON source.organization_id=a.organization_id AND source.id=a.source_document_id
    WHERE r.organization_id=p_organization_id AND ditem.control_kind IN (v_trade,v_advance) AND citem.party_id=p_party_id AND r.created_at<=v_now AND r.effective_date BETWEEN p_from AND p_to
  ), events AS (
    SELECT * FROM source_events UNION ALL SELECT * FROM allocation_events
  ), running AS (
    SELECT e.*,(o.amount+sum(e.balance_effect) OVER(PARTITION BY e.control_kind ORDER BY e.event_date,e.event_type,e.event_id ROWS UNBOUNDED PRECEDING))::numeric AS running_balance
    FROM events e JOIN openings o ON o.kind=e.control_kind
  ), event_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',event_id,'date',event_date,'event_type',event_type,'control_kind',control_kind,
      'document_type',document_type,'document_number',document_number,'reference',reference,'related_document',related_document,'detail',detail,
      'source_document_id',source_document_id,'related_document_id',related_document_id,
      'balance_effect',balance_effect::text,'running_balance',running_balance::text) ORDER BY event_date,event_type,event_id),'[]'::jsonb) AS rows FROM running
  ), ledger AS (
    SELECT mapping.kind,COALESCE(sum(CASE WHEN je.id IS NOT NULL AND d.id IS NOT NULL THEN jl.debit-jl.credit ELSE 0 END),0)::numeric AS debit_balance
    FROM (VALUES(v_trade,v_control),(v_advance,v_advance_account)) mapping(kind,account_id)
    LEFT JOIN finance.journal_lines jl ON jl.organization_id=p_organization_id AND jl.account_id=mapping.account_id AND jl.party_id=p_party_id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=p_to AND je.posted_at<=v_now
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    GROUP BY mapping.kind
  )
  SELECT jsonb_build_object('scope',p_scope,'party',jsonb_build_object('id',v_contact.id,'name',v_contact.display_name,'email',v_contact.email),
    'from',p_from,'to',p_to,'opening',jsonb_build_object('trade',(SELECT amount FROM openings WHERE kind=v_trade)::text,'advances',(SELECT amount FROM openings WHERE kind=v_advance)::text),
    'movements',jsonb_build_object('trade',COALESCE((SELECT sum(balance_effect) FROM events WHERE control_kind=v_trade),0)::text,'advances',COALESCE((SELECT sum(balance_effect) FROM events WHERE control_kind=v_advance),0)::text),
    'closing',jsonb_build_object('trade',(SELECT amount FROM closings WHERE kind=v_trade)::text,'advances',(SELECT amount FROM closings WHERE kind=v_advance)::text),
    'control_bridge',jsonb_build_object('trade_ledger',CASE p_scope WHEN 'customer' THEN (SELECT debit_balance FROM ledger WHERE kind=v_trade)::text ELSE (-(SELECT debit_balance FROM ledger WHERE kind=v_trade))::text END,
      'trade_difference',CASE p_scope WHEN 'customer' THEN ((SELECT debit_balance FROM ledger WHERE kind=v_trade)-(SELECT amount FROM closings WHERE kind=v_trade))::text ELSE (-(SELECT debit_balance FROM ledger WHERE kind=v_trade)-(SELECT amount FROM closings WHERE kind=v_trade))::text END,
      'advance_ledger',CASE p_scope WHEN 'customer' THEN (-(SELECT debit_balance FROM ledger WHERE kind=v_advance))::text ELSE (SELECT debit_balance FROM ledger WHERE kind=v_advance)::text END,
      'advance_difference',CASE p_scope WHEN 'customer' THEN (-(SELECT debit_balance FROM ledger WHERE kind=v_advance)-(SELECT amount FROM closings WHERE kind=v_advance))::text ELSE ((SELECT debit_balance FROM ledger WHERE kind=v_advance)-(SELECT amount FROM closings WHERE kind=v_advance))::text END),
    'events',(SELECT rows FROM event_json),'cutoff_at',v_now,'timezone',v_org.timezone)
  INTO v_data;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type',CASE p_scope WHEN 'customer' THEN 'customer_statement' ELSE 'vendor_statement' END,
    'company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),'filters',jsonb_build_object('scope',p_scope,'party_id',p_party_id,'from',p_from,'to',p_to),
    'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status','posted','provisional',false,'data',v_data);
END; $function$;

CREATE OR REPLACE FUNCTION public.save_financial_document(p_organization_id uuid, p_document_id uuid, p_expected_version integer, p_request_id text, p_idempotency_key text, p_request_hash text, p_payload jsonb)
 RETURNS TABLE(document_id uuid, document_version integer, state text, net_amount finance.amount, tax_amount finance.amount, total_amount finance.amount, material_digest text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid; v_type finance.document_type; v_permission text; v_document finance.business_documents%ROWTYPE;
  v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_created boolean:=p_document_id IS NULL;
  v_line jsonb; v_row jsonb; v_ord bigint; v_line_id uuid; v_keep_ids uuid[]:='{}'; v_original uuid; v_party uuid;
  v_issue date; v_accounting date; v_due date; v_books_start date; v_year_id uuid; v_currency text; v_rounding finance.amount;
  v_rounding_reason text; v_rounding_account uuid; v_rounding_row finance.accounts%ROWTYPE; v_receipt jsonb; v_existing_hash text; v_existing_actor uuid; v_result jsonb;
  v_line_count integer:=0; v_journal_count integer:=0; v_debits finance.amount; v_credits finance.amount; v_movement_amount finance.amount;
  v_plan_total finance.amount:=0; v_plan_amount finance.amount; v_target finance.open_items%ROWTYPE; v_plan_control text; v_plan_side text; v_plan jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'valid idempotency key and request hash required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR
     jsonb_typeof(COALESCE(p_payload->'allocation_plan','[]'::jsonb)) IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>1000000 THEN
    RAISE EXCEPTION 'document payload and typed arrays required' USING ERRCODE='22023';
  END IF;
  BEGIN v_type:=(p_payload->>'document_type')::finance.document_type;
    v_issue:=(p_payload->>'issue_date')::date; v_accounting:=(p_payload->>'accounting_date')::date;
    v_due:=NULLIF(p_payload->>'due_date','')::date; v_party:=NULLIF(p_payload->>'party_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid document type or date' USING ERRCODE='22023'; END;
  IF v_type IS NULL OR v_issue IS NULL OR v_accounting IS NULL OR NOT isfinite(v_issue) OR NOT isfinite(v_accounting) THEN
    RAISE EXCEPTION 'document type, issue date, and accounting date are required' USING ERRCODE='22023';
  END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  SELECT o.status,o.books_start_date INTO v_permission,v_books_start FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_permission NOT IN ('active','onboarding') THEN RAISE EXCEPTION 'company is unavailable for editing' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':documents.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_existing_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,
      v_receipt->>'state',(v_receipt->>'net_amount')::finance.amount,(v_receipt->>'tax_amount')::finance.amount,
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  IF v_type NOT IN ('invoice','customer_credit','bill','vendor_credit','paid_expense','receipt','vendor_payment','customer_refund','vendor_refund',
     'customer_advance','vendor_advance','transfer','manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'this source type is created by its dedicated workflow' USING ERRCODE='23514';
  END IF;
  v_currency:=p_payload->>'currency'; IF v_currency IS DISTINCT FROM finance_private.company_currency(p_organization_id) THEN RAISE EXCEPTION 'Document currency must equal company accounting currency' USING ERRCODE='23514'; END IF;
  IF length(COALESCE(p_payload->>'description',''))>2000 OR length(COALESCE(p_payload->>'external_reference',''))>160 THEN
    RAISE EXCEPTION 'document text exceeds its allowed length' USING ERRCODE='22023';
  END IF;
  v_rounding:=COALESCE(NULLIF(p_payload->>'rounding_adjustment','')::finance.amount,0);
  IF p_payload ? 'rounding_adjustment' THEN PERFORM finance_private.require_decimal_string(p_payload->'rounding_adjustment',2,true); END IF;
  v_rounding_reason:=NULLIF(btrim(p_payload->>'rounding_reason'),'');v_rounding_account:=NULLIF(p_payload->>'rounding_account_id','')::uuid;
  IF abs(v_rounding)>.05 OR (v_rounding=0 AND (v_rounding_reason IS NOT NULL OR v_rounding_account IS NOT NULL)) OR
     (v_rounding<>0 AND (v_rounding_reason IS NULL OR length(v_rounding_reason)>500 OR v_rounding_account IS NULL)) THEN
    RAISE EXCEPTION 'rounding requires an amount up to 0.05, reason, and approved account' USING ERRCODE='23514';
  END IF;
  IF v_rounding_account IS NOT NULL THEN
    SELECT * INTO v_rounding_row FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_rounding_account;
    IF NOT FOUND OR NOT finance_private.validate_mapping_target('rounding_difference',v_rounding_row) THEN
      RAISE EXCEPTION 'invalid rounding-difference account' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_type='opening_balance' THEN
    IF v_accounting<>v_books_start-1 THEN RAISE EXCEPTION 'opening balances use the day before books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening'
      AND p.starts_on=v_accounting AND p.ends_on=v_accounting AND p.status='open';
    IF NOT FOUND THEN RAISE EXCEPTION 'opening period unavailable' USING ERRCODE='23514'; END IF;
  ELSE
    IF v_accounting<v_books_start THEN RAISE EXCEPTION 'accounting date precedes books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p JOIN finance.fiscal_years fy
      ON fy.organization_id=p.organization_id AND fy.id=p.fiscal_year_id
      WHERE p.organization_id=p_organization_id AND p.kind='regular' AND p.starts_on<=v_accounting AND p.ends_on>=v_accounting
        AND p.status='open' AND fy.status='open';
  END IF;
  IF v_type<>'opening_balance' AND v_year_id IS NULL THEN RAISE EXCEPTION 'accounting date has no open fiscal period' USING ERRCODE='23514'; END IF;
  IF v_due IS NOT NULL AND (NOT isfinite(v_due) OR v_due<v_issue) THEN RAISE EXCEPTION 'due date precedes issue date' USING ERRCODE='23514'; END IF;
  IF v_party IS NOT NULL THEN
    IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_customer AND c.is_active) THEN
      RAISE EXCEPTION 'active customer unavailable' USING ERRCODE='23514';
    END IF;
    IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_vendor AND c.is_active) THEN
      RAISE EXCEPTION 'active supplier unavailable' USING ERRCODE='23514';
    END IF;
  ELSIF v_type IN ('invoice','customer_credit','bill','vendor_credit','receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    RAISE EXCEPTION 'party is required for this source type' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('customer_credit','vendor_credit') THEN
    v_original:=NULLIF(p_payload->'trade'->>'original_document_id','')::uuid;
    IF v_original IS NULL OR NOT EXISTS (SELECT 1 FROM finance.business_documents o WHERE o.organization_id=p_organization_id AND o.id=v_original
      AND o.state='posted' AND ((v_type='customer_credit' AND o.document_type='invoice') OR (v_type='vendor_credit' AND o.document_type='bill')) AND o.party_id=v_party) THEN
      RAISE EXCEPTION 'credit must reference its same-party posted original document' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_created THEN
    INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,due_date,external_reference,
      description,currency,rounding_adjustment,rounding_reason,rounding_account_id,version,created_by_member_id,party_snapshot,material_digest)
    VALUES(v_id,p_organization_id,v_type,v_year_id,v_party,v_issue,v_accounting,v_due,NULLIF(p_payload->>'external_reference',''),
      COALESCE(p_payload->>'description',''),v_currency,v_rounding,v_rounding_reason,v_rounding_account,1,v_actor,
      CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,'email',c.email,
        'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END,
      p_request_hash);
    v_document.version:=1;
  ELSE
    SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
    IF v_document.state IN ('posted','void') THEN RAISE EXCEPTION 'posted or void sources cannot be edited' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR v_document.version<>p_expected_version THEN RAISE EXCEPTION 'document version is stale' USING ERRCODE='40001'; END IF;
    IF v_document.document_type<>v_type THEN RAISE EXCEPTION 'document type cannot change' USING ERRCODE='23514'; END IF;
    UPDATE finance.approval_requests AS ar SET state='superseded' WHERE ar.organization_id=p_organization_id AND ar.document_id=v_id AND ar.state IN ('pending','approved');
    UPDATE finance.business_documents d SET fiscal_year_id=v_year_id,party_id=v_party,issue_date=v_issue,accounting_date=v_accounting,due_date=v_due,
      external_reference=NULLIF(p_payload->>'external_reference',''),description=COALESCE(p_payload->>'description',''),currency=v_currency,
      rounding_adjustment=v_rounding,rounding_reason=v_rounding_reason,rounding_account_id=v_rounding_account,state='draft',version=d.version+1,
      updated_at=clock_timestamp(),material_digest=p_request_hash,
      party_snapshot=CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
        'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
    DELETE FROM finance.trade_documents AS td WHERE td.organization_id=p_organization_id AND td.document_id=v_id;
    DELETE FROM finance.money_movements AS mm WHERE mm.organization_id=p_organization_id AND mm.document_id=v_id;
    DELETE FROM finance.transfers AS tr WHERE tr.organization_id=p_organization_id AND tr.document_id=v_id;
    DELETE FROM finance.manual_journal_rows AS jr WHERE jr.organization_id=p_organization_id AND jr.document_id=v_id;
    DELETE FROM finance.document_allocation_plans AS ap WHERE ap.organization_id=p_organization_id AND ap.document_id=v_id;
    v_document.version:=v_document.version+1;
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    UPDATE finance.document_lines AS dl SET line_no=dl.line_no+1000 WHERE dl.organization_id=p_organization_id AND dl.document_id=v_id;
  ELSIF jsonb_array_length(p_payload->'lines')>0 THEN
    RAISE EXCEPTION 'this document type does not accept trade lines' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    INSERT INTO finance.trade_documents(organization_id,document_id,original_document_id,recognition_mode,performance_confirmed,
      supplier_invoice_date,supplier_invoice_key,terms,notes)
    VALUES(p_organization_id,v_id,v_original,COALESCE(p_payload->'trade'->>'recognition_mode','earned_or_incurred'),
      COALESCE((p_payload->'trade'->>'performance_confirmed')::boolean,false),NULLIF(p_payload->'trade'->>'supplier_invoice_date','')::date,
      NULLIF(p_payload->'trade'->>'supplier_invoice_key',''),p_payload->'trade'->>'terms',p_payload->'trade'->>'notes');
  END IF;
  FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS x(value,ordinality) LOOP
    v_line_count:=v_line_count+1; IF v_line_count>500 THEN RAISE EXCEPTION 'too many document lines' USING ERRCODE='22023'; END IF;
    IF v_line->>'description' IS NULL OR length(btrim(v_line->>'description')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'line description required' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_line->'quantity',6,false);
    PERFORM finance_private.require_decimal_string(v_line->'unit_price',6,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_line->'discount_amount','"0.00"'::jsonb),2,false);
    v_line_id:=NULLIF(v_line->>'id','')::uuid;
    IF v_line_id IS NOT NULL THEN
      UPDATE finance.document_lines SET line_no=v_ord,item_id=NULLIF(v_line->>'item_id','')::uuid,
        original_line_id=NULLIF(v_line->>'original_line_id','')::uuid,description=btrim(COALESCE(v_line->>'description','')),
        quantity=(v_line->>'quantity')::finance.quantity,unit_price=(v_line->>'unit_price')::finance.unit_price,
        discount_amount=COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),account_id=(v_line->>'account_id')::uuid,
        cost_center_id=NULLIF(v_line->>'cost_center_id','')::uuid,tax_code_id=NULLIF(v_line->>'tax_code_id','')::uuid,
        tax_mode=COALESCE(v_line->>'tax_mode','exclusive'),cash_flow_class=NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class
        WHERE organization_id=p_organization_id AND finance.document_lines.document_id=v_id AND id=v_line_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'line does not belong to this draft' USING ERRCODE='23514'; END IF;
    ELSE
      INSERT INTO finance.document_lines(organization_id,document_id,line_no,item_id,original_line_id,description,quantity,unit_price,discount_amount,
        account_id,cost_center_id,tax_code_id,tax_mode,net_amount,tax_amount,gross_amount,cash_flow_class)
      VALUES(p_organization_id,v_id,v_ord,NULLIF(v_line->>'item_id','')::uuid,NULLIF(v_line->>'original_line_id','')::uuid,
        btrim(COALESCE(v_line->>'description','')),(v_line->>'quantity')::finance.quantity,(v_line->>'unit_price')::finance.unit_price,
        COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),(v_line->>'account_id')::uuid,
        NULLIF(v_line->>'cost_center_id','')::uuid,NULLIF(v_line->>'tax_code_id','')::uuid,COALESCE(v_line->>'tax_mode','exclusive'),
        0,0,0,NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class) RETURNING id INTO v_line_id;
    END IF;
    v_keep_ids:=array_append(v_keep_ids,v_line_id);
  END LOOP;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND v_line_count=0 THEN RAISE EXCEPTION 'trade source requires at least one line' USING ERRCODE='23514'; END IF;
  IF v_type IN ('customer_credit','vendor_credit') AND EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id
    AND (l.original_line_id IS NULL OR NOT EXISTS(SELECT 1 FROM finance.document_lines source_line WHERE source_line.organization_id=p_organization_id
      AND source_line.id=l.original_line_id AND source_line.document_id=v_original))) THEN
    RAISE EXCEPTION 'every credit line must reference a line on the selected original' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND p_document_id IS NOT NULL THEN
    DELETE FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id AND NOT (l.id=ANY(v_keep_ids));
  END IF;
  IF p_payload ? 'movement' AND jsonb_typeof(p_payload->'movement')='object' THEN
    IF v_type NOT IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') THEN
      RAISE EXCEPTION 'cash movement is not valid for this source type' USING ERRCODE='23514';
    END IF;
    v_row:=p_payload->'movement';
    IF length(COALESCE(v_row->>'reference',''))>160 THEN RAISE EXCEPTION 'movement reference is too long' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    IF (v_type IN ('receipt','customer_advance','vendor_refund') AND COALESCE(v_row->>'direction','in')<>'in') OR
       (v_type IN ('vendor_payment','customer_refund','vendor_advance','paid_expense') AND COALESCE(v_row->>'direction','out')<>'out') THEN
      RAISE EXCEPTION 'cash direction does not match source type' USING ERRCODE='23514';
    END IF;
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
    VALUES(p_organization_id,v_id,(v_row->>'cash_account_id')::uuid,COALESCE(v_row->>'direction','out'),(v_row->>'amount')::finance.amount,
      COALESCE(v_row->>'method','other'),NULLIF(v_row->>'reference',''),COALESCE(v_row->>'cash_flow_class','unclassified')::finance.cash_flow_class);
  END IF;
  IF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') AND
     NOT EXISTS(SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id) THEN
    RAISE EXCEPTION 'this source type requires a cash movement' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'allocation_plan','[]'::jsonb))>0 THEN
    IF v_type NOT IN ('receipt','vendor_payment') OR v_party IS NULL OR
       jsonb_array_length(p_payload->'allocation_plan')>100 THEN
      RAISE EXCEPTION 'allocation plans are only supported for receipt and supplier payment drafts' USING ERRCODE='23514';
    END IF;
    PERFORM finance_private.require_capability(p_organization_id,'dues.read');
    v_plan_control:=CASE WHEN v_type='receipt' THEN 'ar' ELSE 'ap' END;
    v_plan_side:=CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END;
    FOR v_plan IN SELECT value FROM jsonb_array_elements(p_payload->'allocation_plan') LOOP
      IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR (v_plan - 'target_open_item_id' - 'amount') <> '{}'::jsonb OR
         NOT (v_plan ? 'target_open_item_id' AND v_plan ? 'amount') THEN
        RAISE EXCEPTION 'invalid allocation plan row' USING ERRCODE='22023';
      END IF;
      PERFORM finance_private.require_decimal_string(v_plan->'amount',2,false);
      v_plan_amount:=(v_plan->>'amount')::finance.amount;
      IF v_plan_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
        AND oi.id=(v_plan->>'target_open_item_id')::uuid AND oi.party_id=v_party
        AND oi.control_kind=v_plan_control AND oi.side=v_plan_side AND oi.issue_date<=v_accounting FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'allocation target is incompatible or unavailable' USING ERRCODE='23514'; END IF;
      IF v_plan_amount>v_target.original_amount-COALESCE((
        SELECT sum(a.amount) FROM finance.settlement_allocations a LEFT JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_accounting
        WHERE a.organization_id=p_organization_id AND a.effective_date<=v_accounting AND r.id IS NULL
          AND (a.debit_open_item_id=v_target.id OR a.credit_open_item_id=v_target.id)),0) THEN
        RAISE EXCEPTION 'allocation exceeds historical open-item capacity' USING ERRCODE='23514';
      END IF;
      INSERT INTO finance.document_allocation_plans(organization_id,document_id,target_open_item_id,amount)
        VALUES(p_organization_id,v_id,v_target.id,v_plan_amount);
      v_plan_total:=v_plan_total+v_plan_amount;
    END LOOP;
    SELECT m.amount INTO v_movement_amount FROM finance.money_movements m
      WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount IS NULL OR v_plan_total>v_movement_amount THEN
      RAISE EXCEPTION 'planned settlements exceed the draft payment amount' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN
    v_row:=p_payload->'transfer';
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_row->'fee_amount','"0.00"'::jsonb),2,false);
    INSERT INTO finance.transfers(organization_id,document_id,from_cash_account_id,to_cash_account_id,amount,fee_amount,fee_account_id)
    VALUES(p_organization_id,v_id,(v_row->>'from_cash_account_id')::uuid,(v_row->>'to_cash_account_id')::uuid,(v_row->>'amount')::finance.amount,
      COALESCE(NULLIF(v_row->>'fee_amount','')::finance.amount,0),(NULLIF(v_row->>'fee_account_id',''))::uuid);
  END IF;
  IF v_type='transfer' AND NOT EXISTS(SELECT 1 FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id) THEN
    RAISE EXCEPTION 'transfer details required' USING ERRCODE='23514';
  END IF;
  IF v_type<>'transfer' AND p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN RAISE EXCEPTION 'transfer details are not valid for this source type' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows') IS DISTINCT FROM 'array' AND v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'journal row array required' USING ERRCODE='22023';
  END IF;
  IF v_type NOT IN ('manual_journal','controlled_adjustment','opening_balance') AND jsonb_typeof(p_payload->'journal_rows')='array'
     AND jsonb_array_length(p_payload->'journal_rows')>0 THEN RAISE EXCEPTION 'journal rows are only valid for journal sources' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows')='array' THEN
    FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'journal_rows') WITH ORDINALITY AS x(value,ordinality) LOOP
      v_journal_count:=v_journal_count+1; IF v_journal_count>1000 THEN RAISE EXCEPTION 'too many source rows' USING ERRCODE='22023'; END IF;
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'debit','"0.00"'::jsonb),2,false);
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'credit','"0.00"'::jsonb),2,false);
      INSERT INTO finance.manual_journal_rows(organization_id,document_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,
        cash_flow_class,open_item_reference,open_item_due_date)
      VALUES(p_organization_id,v_id,v_ord,(v_line->>'account_id')::uuid,(NULLIF(v_line->>'party_id',''))::uuid,
        (NULLIF(v_line->>'cost_center_id',''))::uuid,COALESCE(NULLIF(v_line->>'debit','')::finance.amount,0),
        COALESCE(NULLIF(v_line->>'credit','')::finance.amount,0),btrim(COALESCE(v_line->>'description','')),
        (NULLIF(v_line->>'cash_flow_class',''))::finance.cash_flow_class,NULLIF(v_line->>'open_item_reference',''),
        NULLIF(v_line->>'open_item_due_date','')::date);
      IF length(btrim(COALESCE(v_line->>'description','')))=0 OR length(v_line->>'description')>500 THEN
        RAISE EXCEPTION 'journal row description required' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(sum(r.debit),0)::finance.amount,COALESCE(sum(r.credit),0)::finance.amount INTO v_debits,v_credits
    FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=v_id;
  IF NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id) THEN
    SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_movement_amount FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount=0 THEN SELECT COALESCE(sum(t.amount+t.fee_amount),0)::finance.amount INTO v_movement_amount FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id; END IF;
    IF v_movement_amount=0 THEN v_movement_amount:=GREATEST(v_debits,v_credits); END IF;
    UPDATE finance.business_documents d SET net_amount=v_movement_amount,tax_amount=0,total_amount=v_movement_amount+d.rounding_adjustment
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
  END IF;
  IF v_type IN ('customer_credit','vendor_credit') THEN
    PERFORM finance_private.assert_credit_note_capacity(p_organization_id,v_id);
  END IF;
  SELECT jsonb_build_object('document_id',d.id,'document_version',d.version,'state',d.state,'net_amount',d.net_amount::text,
    'tax_amount',d.tax_amount::text,'total_amount',d.total_amount::text,'material_digest',d.material_digest) INTO v_result
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.save',p_idempotency_key,p_request_hash,v_actor,200,v_result,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'document.draft.create' ELSE 'document.draft.update' END,
    'business_document',v_id,p_request_id,jsonb_build_object('document_type',v_type,'version',v_document.version,'digest',p_request_hash));
  RETURN QUERY SELECT v_id,(v_result->>'document_version')::integer,v_result->>'state',(v_result->>'net_amount')::finance.amount,
    (v_result->>'tax_amount')::finance.amount,(v_result->>'total_amount')::finance.amount,v_result->>'material_digest';
END $function$;

CREATE OR REPLACE FUNCTION public.save_linked_settlement_draft(p_organization_id uuid, p_document_id uuid, p_expected_version integer, p_request_id text, p_idempotency_key text, p_request_hash text, p_payload jsonb)
 RETURNS TABLE(document_id uuid, document_version integer, state text, total_amount finance.amount, material_digest text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid; v_type finance.document_type; v_source finance.open_items%ROWTYPE; v_doc finance.business_documents%ROWTYPE;
  v_date date; v_amount finance.amount; v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_version integer;
  v_period uuid; v_hash text; v_key_actor uuid; v_receipt jsonb; v_cash uuid;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>10000 OR
    (p_payload-'document_type'-'source_open_item_id'-'target_open_item_id'-'accounting_date'-'amount'-'description'-'cash_account_id'-'reference'-'cash_flow_class'-'method')<>'{}'::jsonb OR
    p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid linked settlement request' USING ERRCODE='22023'; END IF;
  v_type:=(p_payload->>'document_type')::finance.document_type;
  IF v_type IS NULL OR v_type NOT IN ('advance_application','customer_refund','vendor_refund') THEN
    RAISE EXCEPTION 'invalid linked settlement type' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_capability(p_organization_id,CASE WHEN v_type='customer_refund' THEN 'sales.write' WHEN v_type='vendor_refund' THEN 'purchases.write' ELSE 'journal.write' END);
  PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  IF v_type IN ('customer_refund','vendor_refund') THEN PERFORM finance_private.require_capability(p_organization_id,'banking.write'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':linked-settlements.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_key_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='linked-settlements.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_key_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  PERFORM finance_private.require_decimal_string(p_payload->'amount',2,false);
  v_amount:=(p_payload->>'amount')::finance.amount; v_date:=(p_payload->>'accounting_date')::date;
  IF v_date IS NULL OR NOT isfinite(v_date) OR v_amount<=0 OR length(btrim(COALESCE(p_payload->>'description',''))) NOT BETWEEN 1 AND 500
    OR length(COALESCE(p_payload->>'reference',''))>160 THEN RAISE EXCEPTION 'amount, date and description required' USING ERRCODE='22023'; END IF;
  v_period:=finance_private.lock_accounting_date(p_organization_id,v_date,false);
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status='active' AND o.books_start_date<=v_date) THEN
    RAISE EXCEPTION 'company is not writable on this date' USING ERRCODE='42501'; END IF;
  IF p_document_id IS NOT NULL THEN
    SELECT d.* INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
    IF NOT FOUND OR v_doc.document_type<>v_type OR v_doc.state IN ('posted','void') OR p_expected_version IS NULL OR v_doc.version<>p_expected_version THEN
      RAISE EXCEPTION 'settlement draft version is stale' USING ERRCODE='40001'; END IF;
  END IF;
  SELECT x.* INTO v_source FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=(p_payload->>'source_open_item_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'eligible source unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type='advance_application' AND (NULLIF(p_payload->>'cash_account_id','') IS NOT NULL OR NULLIF(p_payload->>'cash_flow_class','') IS NOT NULL) THEN
    RAISE EXCEPTION 'advance application does not move cash' USING ERRCODE='23514'; END IF;
  IF v_type<>'advance_application' THEN
    IF length(btrim(COALESCE(p_payload->>'reference',''))) NOT BETWEEN 1 AND 160
      OR COALESCE(p_payload->>'method','') NOT IN ('cash','bank_transfer','mobile_wallet','card','other') THEN
      RAISE EXCEPTION 'refund payment method and evidence reference required' USING ERRCODE='22023'; END IF;
    v_cash:=NULLIF(p_payload->>'cash_account_id','')::uuid;
    IF v_cash IS NULL OR NOT EXISTS(SELECT 1 FROM finance.cash_accounts c JOIN finance.accounts a ON a.organization_id=c.organization_id AND a.id=c.account_id
      WHERE c.organization_id=p_organization_id AND c.id=v_cash AND c.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL)
      OR COALESCE(p_payload->>'cash_flow_class','') NOT IN ('operating','investing','financing') THEN
      RAISE EXCEPTION 'refund requires an active cash account and cash classification' USING ERRCODE='23514'; END IF;
  END IF;
  IF p_document_id IS NULL THEN
    INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
      net_amount,tax_amount,total_amount,version,created_by_member_id,party_snapshot,material_digest,external_reference)
      SELECT v_id,p_organization_id,v_type,p.fiscal_year_id,v_source.party_id,v_date,v_date,btrim(p_payload->>'description'),finance_private.company_currency(p_organization_id),v_amount,0,v_amount,1,v_actor,
        jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
    'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers),p_request_hash,NULLIF(p_payload->>'reference','')
      FROM finance.accounting_periods p JOIN finance.contacts c ON c.organization_id=p_organization_id AND c.id=v_source.party_id
      WHERE p.organization_id=p_organization_id AND p.id=v_period;
    v_version:=1;
  ELSE
    UPDATE finance.approval_requests ar SET state='superseded' WHERE ar.organization_id=p_organization_id AND ar.document_id=v_id AND ar.state IN ('pending','approved');
    UPDATE finance.business_documents d SET fiscal_year_id=(SELECT p.fiscal_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period),
      party_id=v_source.party_id,issue_date=v_date,accounting_date=v_date,description=btrim(p_payload->>'description'),external_reference=NULLIF(p_payload->>'reference',''),
      net_amount=v_amount,total_amount=v_amount,version=d.version+1,state='draft',material_digest=p_request_hash,updated_at=clock_timestamp(),
      party_snapshot=(SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
    'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_source.party_id)
      WHERE d.organization_id=p_organization_id AND d.id=v_id RETURNING d.version INTO v_version;
    DELETE FROM finance.linked_settlement_details s WHERE s.organization_id=p_organization_id AND s.document_id=v_id;
    DELETE FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    DELETE FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=v_id;
  END IF;
  INSERT INTO finance.linked_settlement_details(organization_id,document_id,document_version,source_open_item_id,target_open_item_id,amount)
    VALUES(p_organization_id,v_id,v_version,v_source.id,NULLIF(p_payload->>'target_open_item_id','')::uuid,v_amount);
  IF v_type<>'advance_application' THEN
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
      VALUES(p_organization_id,v_id,v_cash,CASE WHEN v_type='customer_refund' THEN 'out' ELSE 'in' END,v_amount,p_payload->>'method',btrim(p_payload->>'reference'),(p_payload->>'cash_flow_class')::finance.cash_flow_class);
  END IF;
  PERFORM finance_private.validate_linked_settlement(p_organization_id,v_id);
  v_receipt:=jsonb_build_object('document_id',v_id,'document_version',v_version,'state','draft','total_amount',v_amount::text,'material_digest',p_request_hash);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'linked-settlements.save',p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'linked_settlement.draft.save','business_document',v_id,p_request_id,
    jsonb_build_object('version',v_version,'source_open_item_id',v_source.id,'target_open_item_id',p_payload->>'target_open_item_id','amount',v_amount::text));
  RETURN QUERY SELECT v_id,v_version,'draft'::text,v_amount,p_request_hash;
END; $function$;

CREATE OR REPLACE FUNCTION public.save_write_off_draft(p_organization_id uuid, p_document_id uuid, p_expected_version integer, p_request_id text, p_idempotency_key text, p_request_hash text, p_accounting_date date, p_target_open_item_id uuid, p_expense_account_id uuid, p_amount text, p_reason text)
 RETURNS TABLE(document_id uuid, document_version integer, state text, total_amount finance.amount, material_digest text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_target finance.open_items%ROWTYPE; v_expense finance.accounts%ROWTYPE;
 v_period uuid; v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_amount finance.amount; v_version integer; v_existing jsonb; v_hash text; v_existing_actor uuid;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);
 v_actor:=finance_private.require_capability(p_organization_id,'dues.adjust');
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_amount IS NULL OR
   p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR p_target_open_item_id IS NULL OR p_expense_account_id IS NULL OR
   p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'invalid write-off draft' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':write-offs.save:'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_existing FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='write_offs.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT (v_existing->>'document_id')::uuid,(v_existing->>'document_version')::integer,v_existing->>'state',
   (v_existing->>'total_amount')::finance.amount,v_existing->>'material_digest'; RETURN;
 END IF;
 v_period:=finance_private.lock_accounting_date(p_organization_id,p_accounting_date,false);
 SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_target_open_item_id FOR UPDATE;
 IF NOT FOUND OR v_target.control_kind<>'ar' OR v_target.side<>'debit' OR v_target.issue_date>p_accounting_date THEN
  RAISE EXCEPTION 'write-off target must be a same-company receivable debit item' USING ERRCODE='23514'; END IF;
 PERFORM finance_private.require_decimal_string(to_jsonb(p_amount),2,false);
 SELECT (p_amount)::finance.amount INTO v_amount;
 IF v_amount<=0 OR finance_private.open_item_balance_at(p_organization_id,v_target.id,p_accounting_date,clock_timestamp())<v_amount THEN
  RAISE EXCEPTION 'write-off exceeds the receivable balance available on its accounting date' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_expense FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_expense_account_id FOR SHARE;
 IF NOT FOUND OR v_expense.account_type<>'expense' OR v_expense.control_kind IS NOT NULL OR NOT v_expense.is_active OR NOT v_expense.is_postable THEN
  RAISE EXCEPTION 'write-off requires an active postable non-control expense account' USING ERRCODE='23514'; END IF;
 IF p_document_id IS NULL THEN
  INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
   net_amount,tax_amount,total_amount,version,created_by_member_id,party_snapshot,material_digest)
  SELECT v_id,p_organization_id,'write_off',p.fiscal_year_id,v_target.party_id,p_accounting_date,p_accounting_date,btrim(p_reason),finance_private.company_currency(p_organization_id),v_amount,0,v_amount,1,v_actor,
   jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name),p_request_hash
  FROM finance.accounting_periods p JOIN finance.contacts c ON c.organization_id=p_organization_id AND c.id=v_target.party_id
  WHERE p.organization_id=p_organization_id AND p.id=v_period;
  v_version:=1;
 ELSE
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type<>'write_off' OR v_doc.state<>'draft' OR v_doc.version<>p_expected_version THEN
   RAISE EXCEPTION 'write-off draft version is stale or unavailable' USING ERRCODE='40001'; END IF;
  UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=v_id AND state IN ('pending','approved');
  UPDATE finance.business_documents SET party_id=v_target.party_id,issue_date=p_accounting_date,accounting_date=p_accounting_date,description=btrim(p_reason),
   fiscal_year_id=(SELECT fiscal_year_id FROM finance.accounting_periods WHERE organization_id=p_organization_id AND id=v_period),net_amount=v_amount,total_amount=v_amount,
   version=version+1,state='draft',material_digest=p_request_hash,updated_at=clock_timestamp(),party_snapshot=(SELECT jsonb_build_object('display_name',display_name,'legal_name',legal_name) FROM finance.contacts WHERE organization_id=p_organization_id AND id=v_target.party_id)
   WHERE organization_id=p_organization_id AND id=v_id RETURNING version INTO v_version;
  DELETE FROM finance.manual_journal_rows WHERE organization_id=p_organization_id AND document_id=v_id;
  DELETE FROM finance.write_off_details WHERE organization_id=p_organization_id AND document_id=v_id;
 END IF;
 INSERT INTO finance.write_off_details(organization_id,document_id,target_open_item_id,expense_account_id,amount,reason)
  VALUES(p_organization_id,v_id,v_target.id,p_expense_account_id,v_amount,btrim(p_reason));
 INSERT INTO finance.manual_journal_rows(organization_id,document_id,line_no,account_id,party_id,debit,credit,description,open_item_reference)
 VALUES(p_organization_id,v_id,1,p_expense_account_id,NULL,v_amount,0,btrim(p_reason),NULL),
   (p_organization_id,v_id,2,v_target.account_id,v_target.party_id,0,v_amount,btrim(p_reason),v_target.reference);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN p_document_id IS NULL THEN 'write_off.draft.create' ELSE 'write_off.draft.update' END,
  'business_document',v_id,p_request_id,jsonb_build_object('version',v_version,'digest',p_request_hash,'target_open_item_id',v_target.id,'amount',v_amount::text,'reason',btrim(p_reason)));
 v_existing:=jsonb_build_object('document_id',v_id,'document_version',v_version,'state','draft','total_amount',v_amount::text,'material_digest',p_request_hash);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
 VALUES(p_organization_id,'write_offs.save',p_idempotency_key,p_request_hash,v_actor,200,v_existing,v_id);
 RETURN QUERY SELECT v_id,v_version,'draft'::text,v_amount,p_request_hash;
END; $function$;

NOTIFY pgrst,'reload schema';
