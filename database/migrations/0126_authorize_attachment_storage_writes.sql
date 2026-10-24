-- US-068: authorize a live, owned upload intent before private object I/O.
-- Completion rechecks the same source/intent while holding its source lock.
CREATE FUNCTION finance_private.require_attachment_source_write(
  p_organization_id uuid,p_document_id uuid,p_completed_replay boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source finance.business_documents%ROWTYPE; permission text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'attachments.write');
  SELECT d.* INTO source FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND OR (NOT p_completed_replay AND source.state<>'draft')
    OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002';
  END IF;
  permission:=CASE
    WHEN source.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN source.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense') THEN 'purchases.write'
    WHEN source.document_type='transfer' THEN 'banking.write'
    WHEN source.document_type IN ('manual_journal','opening_balance','advance_application') THEN 'journal.write'
    WHEN source.document_type='write_off' THEN 'dues.adjust'
    ELSE NULL END;
  IF permission IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM finance_private.require_capability(p_organization_id,permission);
  IF source.document_type='advance_application' THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.require_attachment_source_write(uuid,uuid,boolean) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.authorize_attachment_upload_completion(
  p_organization_id uuid,p_intent_id uuid,p_filename text,p_content_type text,p_byte_size bigint,p_sha256 text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE intent finance.attachment_upload_intents%ROWTYPE; actor uuid;
BEGIN
  actor:=identity.current_actor_id();
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT i.* INTO intent FROM finance.attachment_upload_intents i
    JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.requested_by_member_id
    JOIN finance.organizations o ON o.id=i.organization_id AND o.status<>'archived'
    WHERE i.organization_id=p_organization_id AND i.id=p_intent_id AND m.user_id=actor AND m.status='active';
  IF NOT FOUND OR (intent.completed_at IS NULL AND intent.expires_at<=now()) THEN
    RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002';
  END IF;
  IF (p_filename,p_content_type,p_byte_size,p_sha256) IS DISTINCT FROM
    (intent.original_filename,intent.content_type,intent.expected_size,intent.expected_sha256) THEN
    RAISE EXCEPTION 'upload verification failed' USING ERRCODE='42501';
  END IF;
  IF intent.completed_at IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=intent.id
      AND a.sha256=p_sha256 AND a.byte_size=p_byte_size AND a.scan_status IN ('pending','clean','rejected')
  ) THEN RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM finance_private.require_attachment_source_write(p_organization_id,intent.document_id,intent.completed_at IS NOT NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_attachment_upload_completion(uuid,uuid,text,text,bigint,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.authorize_attachment_upload_completion(uuid,uuid,text,text,bigint,text) TO ams_runtime;

DO $patch$
DECLARE signature regprocedure; definition text; old text; replacement text;
BEGIN
  FOR signature,old,replacement IN SELECT * FROM (VALUES
    ('public.create_attachment_upload_intent(uuid,uuid,text,text,bigint,text)'::regprocedure,
     $old$  RETURN QUERY INSERT INTO finance.attachment_upload_intents$old$,
     $new$  PERFORM finance_private.require_attachment_source_write(p_organization_id,p_document_id,false);
  RETURN QUERY INSERT INTO finance.attachment_upload_intents$new$),
    ('public.complete_attachment_upload(uuid,uuid,text,text,bigint,text)'::regprocedure,
     $old$  v_actor:=identity.current_actor_id();$old$,
     $new$  PERFORM public.authorize_attachment_upload_completion(p_organization_id,p_intent_id,p_filename,p_content_type,p_byte_size,p_sha256);
  v_actor:=identity.current_actor_id();$new$),
    ('public.complete_attachment_upload(uuid,uuid,text,text,bigint,text)'::regprocedure,
     $old$AND a.scan_status='pending')$old$,
     $new$AND a.scan_status IN ('pending','clean','rejected'))$new$),
    ('public.complete_attachment_upload(uuid,uuid,text,text,bigint,text)'::regprocedure,
     $old$RETURN QUERY SELECT v_intent.id,'pending'::text; RETURN;$old$,
     $new$RETURN QUERY SELECT a.id,a.scan_status::text FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=v_intent.id; RETURN;$new$),
    ('public.complete_attachment_upload(uuid,uuid,text,text,bigint,text)'::regprocedure,
     $old$  RETURN QUERY SELECT v_intent.id,'pending'::text;$old$,
     $new$  PERFORM finance_private.write_role_audit(p_organization_id,v_intent.requested_by_member_id,'attachment.uploaded','attachment',v_intent.id,
    'attachment-upload-'||v_intent.id::text,jsonb_build_object('document_id',v_intent.document_id,'content_type',p_content_type,'byte_size',p_byte_size,'sha256',p_sha256));
  RETURN QUERY SELECT v_intent.id,'pending'::text;$new$)
  ) AS patches(signature,needle,replacement)
  LOOP
    definition:=pg_catalog.pg_get_functiondef(signature);
    IF length(definition)-length(replace(definition,old,''))<>length(old) THEN
      RAISE EXCEPTION 'expected one attachment authorization anchor in %',signature;
    END IF;
    EXECUTE replace(definition,old,replacement);
  END LOOP;
END;
$patch$;
NOTIFY pgrst,'reload schema';
