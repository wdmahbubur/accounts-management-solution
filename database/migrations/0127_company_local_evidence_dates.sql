-- Evidence upload filters use the same company calendar as the displayed date.
DO $patch$
DECLARE signature regprocedure := 'public.list_evidence_library(uuid,text,date,date,integer,integer)'::regprocedure; definition text; needle text;
BEGIN
  definition := pg_catalog.pg_get_functiondef(signature);
  needle := $old$JOIN finance.organization_members m ON m.organization_id=a.organization_id$old$;
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
    RAISE EXCEPTION 'expected one evidence company join anchor';
  END IF;
  definition := replace(definition,needle,$new$JOIN finance.organizations o ON o.id=a.organization_id
  JOIN finance.organization_members m ON m.organization_id=a.organization_id$new$);
  needle := $old$a.created_at AT TIME ZONE 'Asia/Dhaka'$old$;
  IF length(definition)-length(replace(definition,needle,''))<>2*length(needle) THEN
    RAISE EXCEPTION 'expected two evidence date filter anchors';
  END IF;
  EXECUTE replace(definition,needle,'a.created_at AT TIME ZONE o.timezone');
END;
$patch$;
NOTIFY pgrst,'reload schema';
