-- US-068: scoped upload intents and fail-closed quarantine. The scan worker
-- integration remains pending an approved scanner; objects stay non-downloadable.
BEGIN;

CREATE TABLE finance.attachment_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  uploader_member_id uuid NOT NULL,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  declared_content_type text NOT NULL,
  expected_size bigint NOT NULL CHECK(expected_size BETWEEN 1 AND 10485760),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','expired')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,object_key),
  FOREIGN KEY(organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,uploader_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,attachment_id) REFERENCES finance.attachments(organization_id,id) ON DELETE RESTRICT,
  CHECK(object_key=organization_id||'/attachments/'||id),
  CHECK(original_filename<>'' AND length(original_filename)<=180 AND original_filename !~ '[[:cntrl:]/\\]'),
  CHECK(declared_content_type IN ('application/pdf','image/jpeg','image/png'))
);
CREATE INDEX attachment_upload_intents_expiry_idx ON finance.attachment_upload_intents(expires_at) WHERE state='pending';
ALTER TABLE finance.attachment_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachment_upload_intents FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.attachment_source_writable(p_org uuid,p_document uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_org AND d.id=p_document
   AND d.state='draft' AND (
     (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance','advance_application')
       AND finance_private.has_permission(p_org,'sales.write'))
     OR (d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense')
       AND finance_private.has_permission(p_org,'purchases.write'))
     OR (d.document_type IN ('manual_journal','transfer','opening_balance','reversal')
       AND finance_private.has_permission(p_org,'journal.write'))
     OR (d.document_type IN ('controlled_adjustment','write_off')
       AND finance_private.has_permission(p_org,'dues.adjust'))))
$$;
REVOKE ALL ON FUNCTION finance_private.attachment_source_writable(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.attachment_source_writable(uuid,uuid) TO authenticated;

CREATE FUNCTION finance_private.can_upload_attachment(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
   SELECT 1 FROM finance.attachment_upload_intents i
   JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.uploader_member_id
   WHERE i.object_key=p_object_key AND i.object_key=i.organization_id||'/attachments/'||i.id
     AND i.state='pending' AND i.expires_at>now() AND m.user_id=auth.uid() AND m.status='active'
     AND finance_private.has_permission(i.organization_id,'attachments.write')
     AND finance_private.attachment_source_writable(i.organization_id,i.document_id))
$$;
REVOKE ALL ON FUNCTION finance_private.can_upload_attachment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_upload_attachment(text) TO authenticated;

CREATE POLICY ams_attachment_intent_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='ams-private-artifacts' AND finance_private.can_upload_attachment(name));

CREATE FUNCTION finance_private.can_discard_attachment_upload(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
   SELECT 1 FROM finance.attachment_upload_intents i
   JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.uploader_member_id
   WHERE i.object_key=p_object_key AND i.object_key=i.organization_id||'/attachments/'||i.id
     AND i.state='pending' AND m.user_id=auth.uid() AND m.status='active'
     AND finance_private.has_permission(i.organization_id,'attachments.write'))
$$;
REVOKE ALL ON FUNCTION finance_private.can_discard_attachment_upload(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_discard_attachment_upload(text) TO authenticated;
CREATE POLICY ams_attachment_intent_cleanup ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='ams-private-artifacts' AND finance_private.can_discard_attachment_upload(name));

CREATE FUNCTION public.create_attachment_upload_intent(
 p_organization_id uuid,p_document_id uuid,p_filename text,p_content_type text,p_size bigint,p_request_id text)
RETURNS TABLE(intent_id uuid,object_key text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_id uuid:=gen_random_uuid(); v_key text;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'attachments.write');
 PERFORM finance_private.validate_request_id(p_request_id);
 IF p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 180 OR p_filename ~ '[[:cntrl:]/\\]'
   OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png')
   OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10485760 THEN
   RAISE EXCEPTION 'unsupported or invalid attachment metadata' USING ERRCODE='22023';
 END IF;
 IF NOT finance_private.attachment_source_writable(p_organization_id,p_document_id) THEN
   RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002';
 END IF;
 v_key:=p_organization_id||'/attachments/'||v_id;
 INSERT INTO finance.attachment_upload_intents(organization_id,id,document_id,uploader_member_id,object_key,
   original_filename,declared_content_type,expected_size)
 VALUES(p_organization_id,v_id,p_document_id,v_actor,v_key,p_filename,p_content_type,p_size);
 RETURN QUERY SELECT v_id,v_key,now()+interval '10 minutes';
END $$;
REVOKE ALL ON FUNCTION public.create_attachment_upload_intent(uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_attachment_upload_intent(uuid,uuid,text,text,bigint,text) TO authenticated;

CREATE FUNCTION public.read_attachment_upload_intent(p_organization_id uuid,p_intent_id uuid)
RETURNS TABLE(object_key text,document_id uuid,original_filename text,declared_content_type text,expected_size bigint,expires_at timestamptz,state text,attachment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM finance.attachment_upload_intents i
   JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.uploader_member_id
   WHERE i.organization_id=p_organization_id AND i.id=p_intent_id AND i.state IN ('pending','completed')
     AND (i.state='completed' OR i.expires_at>now()) AND m.user_id=auth.uid() AND m.status='active'
     AND finance_private.has_permission(i.organization_id,'attachments.write')
     AND (i.state='completed' OR finance_private.attachment_source_writable(i.organization_id,i.document_id))) THEN
   RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002';
 END IF;
 RETURN QUERY SELECT i.object_key,i.document_id,i.original_filename,i.declared_content_type,i.expected_size,i.expires_at,i.state,i.attachment_id
 FROM finance.attachment_upload_intents i WHERE i.organization_id=p_organization_id AND i.id=p_intent_id;
END $$;
REVOKE ALL ON FUNCTION public.read_attachment_upload_intent(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_attachment_upload_intent(uuid,uuid) TO authenticated;

CREATE FUNCTION public.complete_attachment_upload(
 p_organization_id uuid,p_intent_id uuid,p_actual_size bigint,p_sha256 text,p_actual_content_type text,p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i finance.attachment_upload_intents%ROWTYPE; v_actor uuid; v_attachment uuid:=gen_random_uuid();
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'attachments.write');
 PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO i FROM finance.attachment_upload_intents WHERE organization_id=p_organization_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND OR i.uploader_member_id<>v_actor OR NOT finance_private.attachment_source_writable(p_organization_id,i.document_id) THEN
   RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002';
 END IF;
 IF i.state='completed' THEN
   IF p_actual_size<>(SELECT byte_size FROM finance.attachments WHERE organization_id=p_organization_id AND id=i.attachment_id)
     OR p_sha256<>(SELECT sha256 FROM finance.attachments WHERE organization_id=p_organization_id AND id=i.attachment_id) THEN
     RAISE EXCEPTION 'completed upload differs from original' USING ERRCODE='P0409';
   END IF;
   RETURN i.attachment_id;
 END IF;
 IF i.state<>'pending' OR i.expires_at<=now() THEN RAISE EXCEPTION 'upload intent expired' USING ERRCODE='P0002'; END IF;
 IF p_actual_size<>i.expected_size OR p_actual_content_type<>i.declared_content_type
   OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'uploaded bytes do not match intent' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='ams-private-artifacts' AND o.name=i.object_key) THEN
   RAISE EXCEPTION 'uploaded object unavailable' USING ERRCODE='P0002';
 END IF;
 INSERT INTO finance.attachments(id,organization_id,object_key,original_filename,content_type,byte_size,sha256,scan_status,uploaded_by_member_id)
 VALUES(v_attachment,p_organization_id,i.object_key,i.original_filename,p_actual_content_type,p_actual_size,p_sha256,'pending',v_actor);
 INSERT INTO finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id)
 VALUES(p_organization_id,v_attachment,i.document_id,v_actor);
 UPDATE finance.attachment_upload_intents SET state='completed',attachment_id=v_attachment
 WHERE organization_id=p_organization_id AND id=p_intent_id;
 INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,document_id,request_id,redacted_change)
 VALUES(p_organization_id,v_actor,'user','attachment.quarantined','attachment',v_attachment,i.document_id,p_request_id,
   jsonb_build_object('filename',i.original_filename,'content_type',p_actual_content_type,'byte_size',p_actual_size,'scan_status','pending'));
 RETURN v_attachment;
END $$;
REVOKE ALL ON FUNCTION public.complete_attachment_upload(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_attachment_upload(uuid,uuid,bigint,text,text,text) TO authenticated;

CREATE FUNCTION public.read_attachment_library(p_organization_id uuid,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL)
RETURNS TABLE(attachment_id uuid,document_id uuid,document_type text,document_number text,original_filename text,
 content_type text,byte_size bigint,scan_status text,uploaded_at timestamptz,uploader_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'attachments.read') THEN
   RAISE EXCEPTION 'evidence unavailable' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page size' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT a.id,d.id,d.document_type::text,d.document_number,a.original_filename,a.content_type,a.byte_size,a.scan_status,a.created_at,m.display_name_snapshot
 FROM finance.attachments a JOIN finance.attachment_links l ON l.organization_id=a.organization_id AND l.attachment_id=a.id
 JOIN finance.business_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id
 JOIN finance.organization_members m ON m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
 WHERE a.organization_id=p_organization_id AND finance_private.can_read_document(d.organization_id,d.id)
   AND (p_after IS NULL OR a.id<p_after)
 ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_attachment_library(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_attachment_library(uuid,integer,uuid) TO authenticated;

CREATE FUNCTION public.read_uploadable_documents(p_organization_id uuid)
RETURNS TABLE(document_id uuid,document_type text,document_number text,accounting_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'attachments.write') THEN
   RAISE EXCEPTION 'evidence unavailable' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT d.id,d.document_type::text,d.document_number,d.accounting_date
 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.state='draft'
  AND finance_private.attachment_source_writable(d.organization_id,d.id)
 ORDER BY d.accounting_date DESC,d.id DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.read_uploadable_documents(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_uploadable_documents(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
