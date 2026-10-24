-- The outbox worker returns organization_id and recipient as output variables.
-- A bare ON CONFLICT column list therefore fails with PL/pgSQL error 42702,
-- including on invoice claims whose invitation INSERT selects no rows.
-- Use the existing unique constraint; preserve the function body and its ACL.
DO $$
DECLARE
  v_signature regprocedure := 'finance_private.claim_outbox_batch(text[],integer,integer)'::regprocedure;
  v_definition text;
  v_constraint name;
  v_old text := 'ON CONFLICT(organization_id,outbox_event_id,channel,recipient) DO UPDATE';
BEGIN
  SELECT c.conname INTO STRICT v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='finance.notification_deliveries'::regclass AND c.contype='u'
      AND pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (organization_id, outbox_event_id, channel, recipient)';
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  IF position(v_old IN v_definition)=0 OR
     length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'expected one ambiguous outbox delivery conflict clause';
  END IF;
  EXECUTE replace(v_definition,v_old,format('ON CONFLICT ON CONSTRAINT %I DO UPDATE',v_constraint));
END $$;

COMMENT ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer)
IS 'Claims bounded, fenced mail leases; delivery upsert uses its existing unique constraint without output-variable ambiguity.';
