-- Refund drafts currently have no source/control-item selection or atomic
-- settlement workflow. Do not let that incomplete path create cash/control
-- journals. The linked refund stories must replace this gate with tested,
-- approval-bound target selection and historical capacity checks.
DO $$
DECLARE
  v_definition text;
  v_anchor text := 'IF v_doc.currency <> ''BDT'' OR v_doc.total_amount <= 0 THEN';
  v_gate text := $gate$IF v_doc.document_type IN ('customer_refund','vendor_refund') THEN
    RAISE EXCEPTION 'linked eligible-credit refund workflow is not enabled' USING ERRCODE = '23514';
  END IF;
  $gate$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef('finance_private.cash_document_posting_plan(uuid,uuid)'::regprocedure);
  IF position(v_anchor IN v_definition)=0 OR
     length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
    RAISE EXCEPTION 'expected one cash planner source validation anchor';
  END IF;
  EXECUTE replace(v_definition,v_anchor,v_gate||v_anchor);
END $$;
