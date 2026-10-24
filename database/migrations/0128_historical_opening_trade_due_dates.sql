-- #174 / US-053: retain historical trade due dates while availability remains
-- the opening journal's cutover date. No posted rows or journals are rewritten.
CREATE FUNCTION finance_private.control_item_due_date_is_valid(
 p_organization_id uuid,p_journal_entry_id uuid,p_control_kind text,p_due_date date
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT p_due_date IS NULL OR (isfinite(p_due_date) AND (
   p_due_date>=j.accounting_date OR (
     j.is_opening AND d.document_type='opening_balance' AND p_control_kind IN ('ar','ap')
     AND j.accounting_date=o.books_start_date-1
   )))
 FROM finance.journal_entries j
 JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
 JOIN finance.organizations o ON o.id=j.organization_id
 WHERE j.organization_id=p_organization_id AND j.id=p_journal_entry_id),false)
$$;
REVOKE ALL ON FUNCTION finance_private.control_item_due_date_is_valid(uuid,uuid,text,date) FROM PUBLIC,ams_runtime,ams_job_worker;

ALTER TABLE finance.open_items DROP CONSTRAINT open_items_due_date_check;
ALTER TABLE finance.open_items ADD CONSTRAINT open_items_due_date_finite_check CHECK(due_date IS NULL OR isfinite(due_date));

DO $patch$
DECLARE signature regprocedure; definition text; needle text; replacement text;
BEGIN
 FOR signature,needle,replacement IN SELECT * FROM (VALUES
  ('finance_private.create_open_item_for_control_line(uuid,uuid,text,date)'::regprocedure,
   'NOT isfinite(v_due) OR v_due<v_entry.accounting_date',
   'NOT finance_private.control_item_due_date_is_valid(p_organization_id,v_entry.id,v_account.control_kind,v_due)'),
  ('finance_private.validate_open_item_insert()'::regprocedure,
   '  RETURN NEW;',
   $new$  IF NOT finance_private.control_item_due_date_is_valid(NEW.organization_id,v_entry.id,v_account.control_kind,NEW.due_date) THEN
    RAISE EXCEPTION 'open-item due date does not agree with its source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;$new$),
  ('finance_private.validate_control_open_item_match()'::regprocedure,
   'AND oi.original_amount=v_expected_amount AND oi.issue_date=v_entry.accounting_date;',
   'AND oi.original_amount=v_expected_amount AND oi.issue_date=v_entry.accounting_date AND finance_private.control_item_due_date_is_valid(oi.organization_id,v_entry.id,v_control,oi.due_date);')
 ) AS patches(signature,needle,replacement)
 LOOP
  definition:=pg_catalog.pg_get_functiondef(signature);
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'expected one historical opening due-date anchor in %',signature;
  END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
END;
$patch$;
NOTIFY pgrst,'reload schema';
