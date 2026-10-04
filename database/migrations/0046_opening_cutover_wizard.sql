-- US-053: preserve the prior trial balance and nominal YTD summary alongside
-- the opening journal, and prevent unreviewed or suspense-bearing cutovers.
CREATE TABLE finance_private.opening_cutover_summaries (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  cutover_date date NOT NULL,
  prior_trial_balance jsonb NOT NULL CHECK (jsonb_typeof(prior_trial_balance)='array'),
  ytd_summary jsonb NOT NULL CHECK (jsonb_typeof(ytd_summary)='array'),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 500),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,document_id),
  FOREIGN KEY (organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON finance_private.opening_cutover_summaries FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.list_opening_cutover_options(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid; v_org finance.organizations%ROWTYPE; v_fy_start date;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'journal.write');
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  SELECT f.starts_on INTO v_fy_start FROM finance.fiscal_years f
   WHERE f.organization_id=p_organization_id AND v_org.books_start_date BETWEEN f.starts_on AND f.ends_on;
  RETURN jsonb_build_object(
    'books_start_date',v_org.books_start_date,'cutover_date',v_org.books_start_date-1,
    'fiscal_year_start',COALESCE(v_fy_start,make_date(extract(year FROM v_org.books_start_date)::integer-
      CASE WHEN extract(month FROM v_org.books_start_date)::integer < v_org.fiscal_year_start_month THEN 1 ELSE 0 END,
      v_org.fiscal_year_start_month,1)),
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,
      'account_type',a.account_type,'normal_side',a.normal_side,'control_kind',a.control_kind) ORDER BY a.code)
      FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable), '[]'::jsonb),
    'parties',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'display_name',c.display_name,
      'is_customer',c.is_customer,'is_vendor',c.is_vendor) ORDER BY c.display_name,c.id)
      FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.is_active),'[]'::jsonb),
    'opening_suspense_account_id',(SELECT m.account_id FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key='opening_suspense')
  );
END; $$;
REVOKE ALL ON FUNCTION public.list_opening_cutover_options(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_opening_cutover_options(uuid) TO ams_runtime;

CREATE FUNCTION public.save_opening_cutover_summary(
  p_organization_id uuid,p_document_id uuid,p_cutover_date date,
  p_prior_trial_balance jsonb,p_ytd_summary jsonb,p_evidence_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid; v_doc finance.business_documents%ROWTYPE; v_books_start date; v_item jsonb; v_account uuid; v_debit numeric; v_credit numeric; v_seen uuid[]:='{}';
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'journal.write');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type<>'opening_balance' OR v_doc.state<>'draft' THEN RAISE EXCEPTION 'opening cutover must be a draft opening-balance document' USING ERRCODE='23514'; END IF;
  SELECT o.books_start_date INTO v_books_start FROM finance.organizations o WHERE o.id=p_organization_id;
  IF p_cutover_date IS DISTINCT FROM v_books_start-1 OR v_doc.accounting_date IS DISTINCT FROM p_cutover_date THEN RAISE EXCEPTION 'cutover must end on the day before books start' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_prior_trial_balance)<>'array' OR jsonb_array_length(p_prior_trial_balance) NOT BETWEEN 1 AND 500 OR
     jsonb_typeof(p_ytd_summary)<>'array' OR jsonb_array_length(p_ytd_summary)>500 OR
     p_evidence_reference IS NULL OR length(btrim(p_evidence_reference)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'cutover summary is incomplete' USING ERRCODE='22023'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_prior_trial_balance) LOOP
    IF jsonb_typeof(v_item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v_item))<>3 OR
       NOT (v_item ?& ARRAY['account_id','debit','credit']) OR
       COALESCE(v_item->>'debit','') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' OR
       COALESCE(v_item->>'credit','') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'trial balance rows must use exact account and money strings' USING ERRCODE='22023'; END IF;
    v_account:=(v_item->>'account_id')::uuid; v_debit:=(v_item->>'debit')::numeric; v_credit:=(v_item->>'credit')::numeric;
    IF v_account=ANY(v_seen) OR (v_debit=0 AND v_credit=0) OR NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_account AND a.is_active AND a.is_postable) THEN RAISE EXCEPTION 'duplicate, empty, or unavailable trial balance account' USING ERRCODE='23514'; END IF;
    v_seen:=array_append(v_seen,v_account);
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_ytd_summary) y
    WHERE jsonb_typeof(y)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(y))<>3 OR NOT (y ?& ARRAY['account_id','debit','credit']) OR
      COALESCE(y->>'debit','') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' OR COALESCE(y->>'credit','') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$' OR
      (y->>'debit')::numeric+(y->>'credit')::numeric=0 OR NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=(y->>'account_id')::uuid AND a.account_type IN ('income','expense') AND a.is_active AND a.is_postable)) THEN
    RAISE EXCEPTION 'YTD rows must reference nominal accounts and exact amounts' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_ytd_summary)) <>
     (SELECT count(*) FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable AND a.account_type IN ('income','expense') AND a.id=ANY(v_seen)) THEN
    RAISE EXCEPTION 'YTD summary must include every nominal trial balance account' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_ytd_summary) y WHERE
    (SELECT count(*) FROM jsonb_array_elements(p_ytd_summary) z WHERE z->>'account_id'=y->>'account_id')<>1 OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_prior_trial_balance) t WHERE t->>'account_id'=y->>'account_id' AND t->>'debit'=y->>'debit' AND t->>'credit'=y->>'credit')) THEN
    RAISE EXCEPTION 'YTD summary must equal the nominal balances in the prior trial balance' USING ERRCODE='23514'; END IF;
  INSERT INTO finance_private.opening_cutover_summaries(organization_id,document_id,cutover_date,prior_trial_balance,ytd_summary,evidence_reference,created_by_member_id)
    VALUES(p_organization_id,p_document_id,p_cutover_date,p_prior_trial_balance,p_ytd_summary,btrim(p_evidence_reference),v_member)
  ON CONFLICT (organization_id,document_id) DO UPDATE SET cutover_date=EXCLUDED.cutover_date,prior_trial_balance=EXCLUDED.prior_trial_balance,
    ytd_summary=EXCLUDED.ytd_summary,evidence_reference=EXCLUDED.evidence_reference,updated_at=clock_timestamp();
  RETURN jsonb_build_object('document_id',p_document_id,'cutover_date',p_cutover_date,'saved',true);
END; $$;
REVOKE ALL ON FUNCTION public.save_opening_cutover_summary(uuid,uuid,date,jsonb,jsonb,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_opening_cutover_summary(uuid,uuid,date,jsonb,jsonb,text) TO ams_runtime;

CREATE FUNCTION public.read_opening_cutover_summary(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
  RETURN (SELECT jsonb_build_object('cutover_date',s.cutover_date,'prior_trial_balance',s.prior_trial_balance,
    'ytd_summary',s.ytd_summary,'evidence_reference',s.evidence_reference,'created_at',s.created_at)
    FROM finance_private.opening_cutover_summaries s JOIN finance.business_documents d ON d.organization_id=s.organization_id AND d.id=s.document_id
    WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id AND d.document_type='opening_balance');
END; $$;
REVOKE ALL ON FUNCTION public.read_opening_cutover_summary(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_opening_cutover_summary(uuid,uuid) TO ams_runtime;

CREATE FUNCTION finance_private.validate_opening_cutover_before_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_summary finance_private.opening_cutover_summaries%ROWTYPE; v_suspense uuid; v_books_start date;
BEGIN
  IF OLD.document_type<>'opening_balance' OR NEW.state=OLD.state OR NEW.state NOT IN ('pending_approval','approved','posted') THEN RETURN NEW; END IF;
  SELECT * INTO v_summary FROM finance_private.opening_cutover_summaries s WHERE s.organization_id=NEW.organization_id AND s.document_id=NEW.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'save and validate the opening cutover summary before approval or posting' USING ERRCODE='23514'; END IF;
  SELECT o.books_start_date,m.account_id INTO v_books_start,v_suspense FROM finance.organizations o LEFT JOIN finance.account_mappings m ON m.organization_id=o.id AND m.mapping_key='opening_suspense' WHERE o.id=NEW.organization_id;
  IF v_summary.cutover_date<>v_books_start-1 OR NEW.accounting_date<>v_summary.cutover_date THEN RAISE EXCEPTION 'opening cutover date does not match company books start' USING ERRCODE='23514'; END IF;
  IF v_suspense IS NULL OR EXISTS(SELECT 1 FROM finance.manual_journal_rows r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id AND r.account_id=v_suspense AND (r.debit<>0 OR r.credit<>0)) THEN
    RAISE EXCEPTION 'opening suspense must be zero before approval or posting' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM finance.manual_journal_rows r JOIN finance.accounts a ON a.organization_id=r.organization_id AND a.id=r.account_id
    WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id AND a.control_kind IS NOT NULL
      AND (r.party_id IS NULL OR NULLIF(btrim(r.open_item_reference),'') IS NULL OR r.open_item_due_date IS NULL)) THEN
    RAISE EXCEPTION 'each opening AR, AP, or advance item needs party, reference and due date' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_summary.prior_trial_balance) t WHERE
    COALESCE((SELECT sum(r.debit) FROM finance.manual_journal_rows r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id AND r.account_id=(t->>'account_id')::uuid),0)<>(t->>'debit')::numeric OR
    COALESCE((SELECT sum(r.credit) FROM finance.manual_journal_rows r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id AND r.account_id=(t->>'account_id')::uuid),0)<>(t->>'credit')::numeric) OR
    EXISTS(SELECT 1 FROM finance.manual_journal_rows r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id AND NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(v_summary.prior_trial_balance) t WHERE t->>'account_id'=r.account_id::text)) THEN
    RAISE EXCEPTION 'opening journal rows must exactly match the validated prior trial balance' USING ERRCODE='23514'; END IF;
  IF (SELECT COALESCE(sum((t->>'debit')::numeric),0) FROM jsonb_array_elements(v_summary.prior_trial_balance) t)<>
     (SELECT COALESCE(sum((t->>'credit')::numeric),0) FROM jsonb_array_elements(v_summary.prior_trial_balance) t) THEN
    RAISE EXCEPTION 'opening trial balance is unbalanced; suspense must be resolved before approval' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.validate_opening_cutover_before_transition() FROM PUBLIC,ams_runtime;
CREATE TRIGGER opening_cutover_transition_guard BEFORE UPDATE OF state ON finance.business_documents
FOR EACH ROW EXECUTE FUNCTION finance_private.validate_opening_cutover_before_transition();
