-- Advancing a tax code's effective version must update the table column,
-- not the identically named RETURNS TABLE variable. Preserve snapshots/ACLs.
DO $$
DECLARE
  v_definition text;
  v_old text := 'UPDATE finance.tax_codes SET effective_to=p_effective_from-1,row_version=row_version+1
      WHERE organization_id=p_organization_id AND id=v_overlap.id';
  v_new text := 'UPDATE finance.tax_codes tc SET effective_to=p_effective_from-1,row_version=tc.row_version+1
      WHERE tc.organization_id=p_organization_id AND tc.id=v_overlap.id';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef('public.create_tax_code_version(uuid,text,text,text,text,finance.rate,text,uuid,uuid,text,date,date,integer)'::regprocedure);
  IF position(v_old IN v_definition)=0 OR
     length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'expected one ambiguous tax version update';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END $$;
