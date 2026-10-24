-- #176 / US-061: snapshot-only close/reopen for a genuinely zero-nominal year.
-- Existing journal closes and their immutable snapshots remain unchanged.
ALTER TABLE finance.year_close_runs ALTER COLUMN close_document_id DROP NOT NULL;
ALTER TABLE finance.year_close_runs
 ADD COLUMN close_kind text NOT NULL DEFAULT 'journal' CHECK(close_kind IN ('journal','zero_nominal')),
 ADD COLUMN reopened_at timestamptz,
 ADD COLUMN reopened_by_member_id uuid,
 ADD COLUMN reopen_reason text,
 ADD CONSTRAINT year_close_run_reopen_member_fk FOREIGN KEY(organization_id,reopened_by_member_id)
   REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT year_close_run_kind_check CHECK(
  (close_kind='journal' AND close_document_id IS NOT NULL AND reopened_at IS NULL AND reopened_by_member_id IS NULL AND reopen_reason IS NULL)
  OR (close_kind='zero_nominal' AND close_document_id IS NULL AND reopen_document_id IS NULL AND (
    (reopened_at IS NULL AND reopened_by_member_id IS NULL AND reopen_reason IS NULL)
    OR (reopened_at IS NOT NULL AND isfinite(reopened_at) AND reopened_by_member_id IS NOT NULL
      AND reopen_reason IS NOT NULL AND length(btrim(reopen_reason)) BETWEEN 10 AND 1000)
  ))
 );
DROP INDEX finance.year_one_live_close_idx;
CREATE UNIQUE INDEX year_one_live_close_idx ON finance.year_close_runs(organization_id,fiscal_year_id)
 WHERE reopen_document_id IS NULL AND reopened_at IS NULL;

CREATE OR REPLACE FUNCTION finance_private.guard_year_close_run_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'year-close history is append-only' USING ERRCODE='23514'; END IF;
 IF (NEW.organization_id,NEW.id,NEW.fiscal_year_id,NEW.close_document_id,NEW.close_kind,NEW.created_by_member_id,NEW.report_snapshot,NEW.created_at)
   IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.fiscal_year_id,OLD.close_document_id,OLD.close_kind,OLD.created_by_member_id,OLD.report_snapshot,OLD.created_at)
   OR OLD.reopen_document_id IS NOT NULL OR OLD.reopened_at IS NOT NULL
   OR (NEW.close_kind='journal' AND NEW.reopen_document_id IS NULL)
   OR (NEW.close_kind='zero_nominal' AND NEW.reopened_at IS NULL) THEN
  RAISE EXCEPTION 'year-close history is append-only; only one reopen event is allowed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_year_close_run_mutation() FROM PUBLIC,ams_runtime,ams_job_worker;

DO $patch$
DECLARE signature regprocedure; current_signature regprocedure; definition text; needle text; replacement text;
BEGIN
 FOR signature,needle,replacement IN SELECT * FROM (VALUES
  ('finance_private.year_close_preview(uuid,uuid)'::regprocedure,
   'AND r.reopen_document_id IS NULL', 'AND r.reopen_document_id IS NULL AND r.reopened_at IS NULL'),
  ('finance_private.year_close_preview(uuid,uuid)'::regprocedure,
   ' AND r.nominal_count>0', ''),
  ('finance_private.year_close_preview(uuid,uuid)'::regprocedure,
   $old$'nominal_account_count',r.nominal_count,$old$,
   $new$'nominal_account_count',r.nominal_count,'close_kind',CASE WHEN r.nominal_count=0 THEN 'zero_nominal' ELSE 'journal' END,$new$),
  ('public.list_year_close_workspace(uuid)'::regprocedure,
   'AND r.reopen_document_id IS NULL', 'AND r.reopen_document_id IS NULL AND r.reopened_at IS NULL'),
  ('public.list_year_close_workspace(uuid)'::regprocedure,
   $old$'run_id',r.id,'document_id',r.close_document_id,$old$,
   $new$'run_id',r.id,'close_kind',r.close_kind,'document_id',r.close_document_id,$new$),
  ('public.list_year_close_workspace(uuid)'::regprocedure,
   $old$'run_id',r.id,'close_document_id',r.close_document_id,'reopen_document_id',r.reopen_document_id,$old$,
   $new$'run_id',r.id,'close_kind',r.close_kind,'close_document_id',r.close_document_id,'reopen_document_id',r.reopen_document_id,
      'reopened_at',r.reopened_at,'reopened_by_member_id',r.reopened_by_member_id,'reopen_reason',r.reopen_reason,$new$),
  ('public.close_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   '  INSERT INTO finance.business_documents(',
   $new$  IF (v_preview->>'nominal_account_count')::integer=0 THEN
    v_doc:=NULL;v_entry:=NULL;v_number:=NULL;
  ELSE
  INSERT INTO finance.business_documents($new$),
  ('public.close_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   '  INSERT INTO finance.year_close_runs(organization_id,id,fiscal_year_id,close_document_id,created_by_member_id,report_snapshot,created_at)',
   '  END IF;
  INSERT INTO finance.year_close_runs(organization_id,id,fiscal_year_id,close_document_id,created_by_member_id,report_snapshot,created_at,close_kind)'),
  ('public.close_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   $old$jsonb_build_object('version',1,'preview',v_preview,'close_reason',btrim(p_reason),'closed_at',v_now,'journal_entry_id',v_entry),v_now);$old$,
   $new$jsonb_build_object('version',2,'close_kind',v_preview->>'close_kind','preview',v_preview,'close_reason',btrim(p_reason),'closed_at',v_now,'journal_entry_id',v_entry),v_now,v_preview->>'close_kind');$new$),
  ('public.close_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   $old$v_receipt:=jsonb_build_object('run_id',v_run,'document_id',v_doc,$old$,
   $new$v_receipt:=jsonb_build_object('run_id',v_run,'close_kind',v_preview->>'close_kind','document_id',v_doc,$new$),
  ('public.reopen_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   'AND r.reopen_document_id IS NULL FOR UPDATE;',
   'AND r.reopen_document_id IS NULL AND r.reopened_at IS NULL FOR UPDATE;'),
  ('public.reopen_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   $old$  SELECT * INTO v_source FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_run.close_document_id AND d.state='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'posted year-close source is unavailable' USING ERRCODE='23514'; END IF;$old$,
   $new$  IF v_run.close_kind='journal' THEN
    SELECT * INTO v_source FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_run.close_document_id AND d.state='posted';
    IF NOT FOUND THEN RAISE EXCEPTION 'posted year-close source is unavailable' USING ERRCODE='23514'; END IF;
  END IF;$new$),
  ('public.reopen_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   '  INSERT INTO finance.business_documents(',
   $new$  IF v_run.close_kind='zero_nominal' THEN
    v_doc_id:=NULL;v_entry_id:=NULL;v_number:=NULL;
    UPDATE finance.year_close_runs SET reopened_at=v_now,reopened_by_member_id=v_actor,reopen_reason=btrim(p_reason)
      WHERE organization_id=p_organization_id AND id=v_run.id;
  ELSE
  INSERT INTO finance.business_documents($new$),
  ('public.reopen_fiscal_year(uuid,uuid,text,text,text,text)'::regprocedure,
   $old$  v_receipt:=jsonb_build_object('run_id',v_run.id,'reopen_document_id',v_doc_id,$old$,
   $new$  END IF;
  v_receipt:=jsonb_build_object('run_id',v_run.id,'close_kind',v_run.close_kind,'reopen_document_id',v_doc_id,$new$)
 ) AS patches(signature,needle,replacement) ORDER BY patches.signature::text
 LOOP
  IF current_signature IS DISTINCT FROM signature THEN
   IF current_signature IS NOT NULL THEN EXECUTE definition; END IF;
   current_signature:=signature;
   definition:=replace(pg_catalog.pg_get_functiondef(signature),E'\r\n',E'\n');
  END IF;
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'expected one zero-nominal year close anchor in %: %',signature,needle;
  END IF;
  definition:=replace(definition,needle,replacement);
 END LOOP;
 IF current_signature IS NOT NULL THEN EXECUTE definition; END IF;
END;
$patch$;
NOTIFY pgrst,'reload schema';
