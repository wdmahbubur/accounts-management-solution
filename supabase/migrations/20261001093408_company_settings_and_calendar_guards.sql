-- US-012: reviewed, versioned company configuration; no financial posting.
BEGIN;
ALTER TABLE finance.organizations ADD COLUMN settings_version integer NOT NULL DEFAULT 1 CHECK(settings_version>0),
  ADD COLUMN foundation_locked_at timestamptz,
  ADD COLUMN contact_email text NOT NULL DEFAULT '',
  ADD COLUMN contact_phone text NOT NULL DEFAULT '';

CREATE FUNCTION finance_private.company_configuration_locked(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_org AND (o.foundation_locked_at IS NOT NULL OR o.status<>'onboarding'))
 OR EXISTS(SELECT 1 FROM finance.business_documents WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.import_jobs WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.bank_imports WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.document_sequences WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.report_snapshots WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.export_jobs WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.year_close_runs WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.period_events WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM finance.accounting_periods WHERE organization_id=p_org AND status='locked')
 OR EXISTS(SELECT 1 FROM finance.fiscal_years WHERE organization_id=p_org AND status='closed')
$$;
REVOKE ALL ON FUNCTION finance_private.company_configuration_locked(uuid) FROM PUBLIC,anon,authenticated;
UPDATE finance.organizations o SET foundation_locked_at=now() WHERE finance_private.company_configuration_locked(o.id);

CREATE FUNCTION finance_private.freeze_company_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Conditional row UPDATE serializes the first activity with configuration
  -- changes. Once frozen, later inserts need no exclusive configuration lock.
  UPDATE finance.organizations SET foundation_locked_at=clock_timestamp(),settings_version=settings_version+1
  WHERE id=NEW.organization_id AND foundation_locked_at IS NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.freeze_company_foundation() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['business_documents','import_jobs','bank_imports','document_sequences','report_snapshots','export_jobs','year_close_runs','period_events'] LOOP
  EXECUTE format('CREATE TRIGGER freeze_company_foundation BEFORE INSERT ON finance.%I FOR EACH ROW EXECUTE FUNCTION finance_private.freeze_company_foundation()',t);
 END LOOP;
END $$;

CREATE FUNCTION finance_private.guard_company_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.base_currency IS DISTINCT FROM OLD.base_currency THEN
  RAISE EXCEPTION 'V1 currency is immutable BDT' USING ERRCODE='22023';
 END IF;
 IF (NEW.books_start_date,NEW.fiscal_year_start_month) IS DISTINCT FROM (OLD.books_start_date,OLD.fiscal_year_start_month)
   AND finance_private.company_configuration_locked(OLD.id) THEN
  RAISE EXCEPTION 'accounting foundation is locked' USING ERRCODE='P0412';
 END IF;
 IF OLD.foundation_locked_at IS NULL AND NEW.status<>'onboarding' THEN
  NEW.foundation_locked_at:=COALESCE(NEW.foundation_locked_at,clock_timestamp());
  IF NEW.settings_version=OLD.settings_version THEN NEW.settings_version:=OLD.settings_version+1; END IF;
 END IF;
 IF OLD.foundation_locked_at IS NOT NULL AND NEW.foundation_locked_at IS DISTINCT FROM OLD.foundation_locked_at THEN
  RAISE EXCEPTION 'accounting foundation lock is permanent' USING ERRCODE='P0412';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_company_foundation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_company_foundation BEFORE UPDATE OF base_currency,books_start_date,fiscal_year_start_month,foundation_locked_at,status
 ON finance.organizations FOR EACH ROW EXECUTE FUNCTION finance_private.guard_company_foundation();

CREATE FUNCTION finance_private.validate_company_period_bounds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_books date; v_year finance.fiscal_years%ROWTYPE;
BEGIN
 SELECT books_start_date INTO v_books FROM finance.organizations WHERE id=NEW.organization_id;
 IF NOT isfinite(NEW.starts_on) OR NOT isfinite(NEW.ends_on) THEN
  RAISE EXCEPTION 'invalid period date' USING ERRCODE='22023';
 END IF;
 IF NEW.kind='opening' THEN
  IF NEW.starts_on<>v_books-1 OR NEW.ends_on<>v_books-1 OR NEW.fiscal_year_id IS NOT NULL THEN
   RAISE EXCEPTION 'opening period must be the cutover day before books start' USING ERRCODE='22023';
  END IF;
 ELSE
  SELECT * INTO v_year FROM finance.fiscal_years WHERE organization_id=NEW.organization_id AND id=NEW.fiscal_year_id;
  IF NOT FOUND THEN RETURN NEW; END IF; -- Preserve the authoritative composite-FK denial.
  IF NEW.starts_on<v_books OR NEW.starts_on<v_year.starts_on OR NEW.ends_on>v_year.ends_on THEN
   RAISE EXCEPTION 'period lies outside company fiscal calendar' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.validate_company_period_bounds() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_company_period_bounds BEFORE INSERT OR UPDATE OF starts_on,ends_on,fiscal_year_id,kind
 ON finance.accounting_periods FOR EACH ROW EXECUTE FUNCTION finance_private.validate_company_period_bounds();

CREATE FUNCTION public.read_company_settings(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o finance.organizations%ROWTYPE;
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'company.read');
 SELECT * INTO o FROM finance.organizations WHERE id=p_organization_id;
 RETURN jsonb_build_object('organization_id',o.id,'name',o.name,'legal_name',o.legal_name,'country_code',o.country_code,
  'base_currency',o.base_currency,'timezone',o.timezone,'books_start_date',o.books_start_date,
  'fiscal_year_start_month',o.fiscal_year_start_month,'address',jsonb_build_object(
    'line1',COALESCE(o.address->>'line1',''),'line2',COALESCE(o.address->>'line2',''),
    'city',COALESCE(o.address->>'city',''),'postal_code',COALESCE(o.address->>'postal_code','')),
  'contact_email',o.contact_email,'contact_phone',o.contact_phone,
  'settings_version',o.settings_version,'foundation_locked',finance_private.company_configuration_locked(o.id),
  'calendar',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',p.label,'kind',p.kind,'starts_on',p.starts_on,'ends_on',p.ends_on,'status',p.status) ORDER BY p.starts_on)
   FROM finance.accounting_periods p WHERE p.organization_id=o.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_company_settings(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_company_settings(uuid) TO authenticated;

CREATE FUNCTION public.update_company_settings(p_organization_id uuid,p_expected_version integer,p_changes jsonb,p_reason text,p_request_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o finance.organizations%ROWTYPE; v_actor uuid; before_profile jsonb; profile jsonb; k text;
 v_start date; v_end date; v_cursor date; v_period_end date; v_year uuid; v_books date; v_month smallint; v_rebuild boolean;
BEGIN
 PERFORM finance_private.lock_role_admin(p_organization_id);
 v_actor:=finance_private.require_capability(p_organization_id,'company.update');
 PERFORM finance_private.require_recent_auth();
 PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO o FROM finance.organizations WHERE id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>o.settings_version THEN
  RAISE EXCEPTION 'company settings version changed' USING ERRCODE='P0409';
 END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'valid settings object and reason required' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) key WHERE key NOT IN
  ('name','legal_name','country_code','base_currency','timezone','books_start_date','fiscal_year_start_month','address','contact_email','contact_phone')) THEN
  RAISE EXCEPTION 'unexpected settings field' USING ERRCODE='22023';
 END IF;
 before_profile:=jsonb_build_object('name',o.name,'legal_name',o.legal_name,'country_code',o.country_code,'base_currency',o.base_currency,
  'timezone',o.timezone,'books_start_date',o.books_start_date,'fiscal_year_start_month',o.fiscal_year_start_month,
  'address',o.address,'contact_email',o.contact_email,'contact_phone',o.contact_phone);
 profile:=before_profile||p_changes;
 FOREACH k IN ARRAY ARRAY['name','legal_name','country_code','base_currency','timezone','books_start_date','contact_email','contact_phone'] LOOP
  IF jsonb_typeof(profile->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid settings text' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF length(btrim(profile->>'name')) NOT BETWEEN 1 AND 160 OR length(btrim(profile->>'legal_name')) NOT BETWEEN 1 AND 240
  OR profile->>'country_code' !~ '^[A-Z]{2}$' OR profile->>'base_currency'<>'BDT'
  OR length(profile->>'timezone')>64 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=profile->>'timezone')
  OR profile->>'books_start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(profile->'fiscal_year_start_month') IS DISTINCT FROM 'number'
  OR profile->>'fiscal_year_start_month' !~ '^([1-9]|1[012])$'
  OR length(profile->>'contact_email')>254 OR (profile->>'contact_email'<>'' AND profile->>'contact_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  OR length(profile->>'contact_phone')>32 OR profile->>'contact_phone' !~ '^[0-9+() .-]*$'
  OR jsonb_typeof(profile->'address') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'invalid company configuration' USING ERRCODE='22023';
 END IF;
 IF p_changes?'address' THEN
  IF EXISTS(SELECT 1 FROM jsonb_each(p_changes->'address') e WHERE e.key NOT IN ('line1','line2','city','postal_code')
    OR jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')>240) THEN
    RAISE EXCEPTION 'invalid address' USING ERRCODE='22023';
  END IF;
  -- Preserve unrelated legacy address keys; the public read exposes only the
  -- documented address projection. An omitted address field is never deleted.
  profile:=jsonb_set(profile,'{address}',o.address||(p_changes->'address'));
 END IF;
 profile:=profile||jsonb_build_object('name',btrim(profile->>'name'),'legal_name',btrim(profile->>'legal_name'),
   'contact_email',lower(btrim(profile->>'contact_email')),'contact_phone',btrim(profile->>'contact_phone'));
 BEGIN v_books:=(profile->>'books_start_date')::date; EXCEPTION WHEN datetime_field_overflow THEN
  RAISE EXCEPTION 'invalid books start date' USING ERRCODE='22023'; END;
 IF NOT isfinite(v_books) OR v_books<'1900-01-02' OR v_books>'9998-12-31' THEN RAISE EXCEPTION 'invalid books date range' USING ERRCODE='22023'; END IF;
 v_month:=(profile->>'fiscal_year_start_month')::smallint;
 v_rebuild:=(v_books,v_month) IS DISTINCT FROM (o.books_start_date,o.fiscal_year_start_month);
 IF v_rebuild AND finance_private.company_configuration_locked(o.id) THEN
  RAISE EXCEPTION 'accounting foundation is locked' USING ERRCODE='P0412';
 END IF;
 IF profile=before_profile THEN RETURN o.settings_version; END IF;
 -- Only unused onboarding calendars may be rebuilt; first-activity triggers
 -- acquire this same organization row lock before freezing the configuration.
 IF v_rebuild THEN
  DELETE FROM finance.accounting_periods WHERE organization_id=o.id;
  DELETE FROM finance.fiscal_years WHERE organization_id=o.id;
 END IF;
 UPDATE finance.organizations SET name=btrim(profile->>'name'),legal_name=btrim(profile->>'legal_name'),country_code=profile->>'country_code',
  timezone=profile->>'timezone',books_start_date=v_books,fiscal_year_start_month=v_month,address=profile->'address',
  contact_email=profile->>'contact_email',contact_phone=profile->>'contact_phone',settings_version=settings_version+1,updated_at=clock_timestamp()
 WHERE id=o.id;
 IF v_rebuild THEN
  v_start:=make_date(extract(year from v_books)::integer-CASE WHEN extract(month from v_books)<v_month THEN 1 ELSE 0 END,v_month,1);
  v_end:=(v_start+interval '1 year - 1 day')::date; v_year:=gen_random_uuid();
  INSERT INTO finance.fiscal_years(id,organization_id,label,starts_on,ends_on) VALUES(v_year,o.id,'FY '||v_start::text,v_start,v_end);
  INSERT INTO finance.accounting_periods(organization_id,label,kind,starts_on,ends_on) VALUES(o.id,'Opening '||(v_books-1)::text,'opening',v_books-1,v_books-1);
  v_cursor:=v_books;
  WHILE v_cursor<=v_end LOOP
   v_period_end:=LEAST((date_trunc('month',v_cursor::timestamp)+interval '1 month - 1 day')::date,v_end);
   INSERT INTO finance.accounting_periods(organization_id,fiscal_year_id,label,kind,starts_on,ends_on)
   VALUES(o.id,v_year,to_char(v_cursor,'YYYY-MM'),'regular',v_cursor,v_period_end);
   v_cursor:=v_period_end+1;
  END LOOP;
 END IF;
 INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,reason,redacted_change)
 VALUES(o.id,v_actor,'user','company.settings_updated','organization',o.id,p_request_id,btrim(p_reason),
  jsonb_build_object('from_version',o.settings_version,'to_version',o.settings_version+1,
    'before',before_profile-ARRAY['address','contact_email','contact_phone'],
    'after',profile-ARRAY['address','contact_email','contact_phone'],
    'changed_fields',(SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_object_keys(profile) key WHERE profile->key IS DISTINCT FROM before_profile->key),
    'contact_values_redacted',true,'calendar_rebuilt',v_rebuild));
 RETURN o.settings_version+1;
END $$;
REVOKE ALL ON FUNCTION public.update_company_settings(uuid,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_settings(uuid,integer,jsonb,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
