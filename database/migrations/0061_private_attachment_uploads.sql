-- US-068: one-time, organization scoped upload intents. Objects remain pending_scan
-- until a separately deployed scanner records a real result.
CREATE TABLE finance.attachment_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  requested_by_member_id uuid NOT NULL,
  document_id uuid NOT NULL,
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 180),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv')),
  expected_size bigint NOT NULL CHECK (expected_size BETWEEN 1 AND 10485760),
  expected_sha256 text NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,requested_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE finance.attachment_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachment_upload_intents FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.create_attachment_upload_intent(
  p_organization_id uuid,p_document_id uuid,p_filename text,p_content_type text,p_byte_size bigint,p_sha256 text
) RETURNS TABLE(intent_id uuid,object_key text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_member uuid; v_type text;
BEGIN
  v_actor:=identity.current_actor_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 180 OR p_filename ~ '[/\\]' OR p_filename ~ '[[:cntrl:]]'
    OR p_filename IN ('.','..') OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv')
    OR p_byte_size NOT BETWEEN 1 AND 10485760 OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid attachment metadata' USING ERRCODE='22023';
  END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
   WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' AND o.status<>'archived';
  IF v_member IS NULL OR NOT finance_private.has_permission(p_organization_id,'attachments.write') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE='42501';
  END IF;
  SELECT d.document_type::text INTO v_type FROM finance.business_documents d
   WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.state='draft';
  IF v_type IS NULL OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002';
  END IF;
  IF (v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND NOT finance_private.has_permission(p_organization_id,'sales.write'))
    OR (v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense') AND NOT finance_private.has_permission(p_organization_id,'purchases.write'))
    OR (v_type='transfer' AND NOT finance_private.has_permission(p_organization_id,'banking.write'))
    OR (v_type IN ('manual_journal','opening_balance') AND NOT finance_private.has_permission(p_organization_id,'journal.write')) THEN
    RAISE EXCEPTION 'source write permission required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO finance.attachment_upload_intents(organization_id,requested_by_member_id,document_id,original_filename,content_type,expected_size,expected_sha256)
   VALUES(p_organization_id,v_member,p_document_id,p_filename,p_content_type,p_byte_size,p_sha256)
   RETURNING id,p_organization_id||'/attachments/'||id,finance.attachment_upload_intents.expires_at;
END $$;
REVOKE ALL ON FUNCTION public.create_attachment_upload_intent(uuid,uuid,text,text,bigint,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.create_attachment_upload_intent(uuid,uuid,text,text,bigint,text) TO ams_runtime;

CREATE FUNCTION public.complete_attachment_upload(p_organization_id uuid,p_intent_id uuid,p_filename text,p_content_type text,p_byte_size bigint,p_sha256 text)
RETURNS TABLE(attachment_id uuid,scan_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intent finance.attachment_upload_intents%ROWTYPE; v_actor uuid; v_type text;
BEGIN
  v_actor:=identity.current_actor_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT i.* INTO v_intent FROM finance.attachment_upload_intents i
   JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.requested_by_member_id
   WHERE i.organization_id=p_organization_id AND i.id=p_intent_id AND m.user_id=v_actor AND m.status='active' FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_intent.completed_at IS NOT NULL THEN
    IF p_byte_size=v_intent.expected_size AND p_sha256=v_intent.expected_sha256 AND p_filename=v_intent.original_filename AND p_content_type=v_intent.content_type
      AND EXISTS(SELECT 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=v_intent.id AND a.scan_status='pending') THEN
      RETURN QUERY SELECT v_intent.id,'pending'::text; RETURN;
    END IF;
    RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_intent.expires_at<=now() THEN RAISE EXCEPTION 'upload intent unavailable' USING ERRCODE='P0002'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'attachments.write') OR p_byte_size<>v_intent.expected_size OR p_sha256<>v_intent.expected_sha256
    OR p_filename IS DISTINCT FROM v_intent.original_filename OR p_content_type IS DISTINCT FROM v_intent.content_type THEN
    RAISE EXCEPTION 'upload verification failed' USING ERRCODE='42501';
  END IF;
  SELECT d.document_type::text INTO v_type FROM finance.business_documents d
   WHERE d.organization_id=p_organization_id AND d.id=v_intent.document_id AND d.state='draft';
  IF v_type IS NULL OR NOT finance_private.can_read_document(p_organization_id,v_intent.document_id) THEN
    RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002';
  END IF;
  IF (v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND NOT finance_private.has_permission(p_organization_id,'sales.write'))
    OR (v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense') AND NOT finance_private.has_permission(p_organization_id,'purchases.write'))
    OR (v_type='transfer' AND NOT finance_private.has_permission(p_organization_id,'banking.write'))
    OR (v_type IN ('manual_journal','opening_balance') AND NOT finance_private.has_permission(p_organization_id,'journal.write')) THEN
    RAISE EXCEPTION 'source write permission required' USING ERRCODE='42501';
  END IF;
  INSERT INTO finance.attachments(id,organization_id,object_key,original_filename,content_type,byte_size,sha256,scan_status,uploaded_by_member_id)
   VALUES(v_intent.id,p_organization_id,p_organization_id||'/attachments/'||v_intent.id,v_intent.original_filename,v_intent.content_type,p_byte_size,p_sha256,'pending',v_intent.requested_by_member_id);
  INSERT INTO finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id)
   VALUES(p_organization_id,v_intent.id,v_intent.document_id,v_intent.requested_by_member_id);
  UPDATE finance.attachment_upload_intents SET completed_at=now() WHERE id=v_intent.id AND organization_id=p_organization_id;
  RETURN QUERY SELECT v_intent.id,'pending'::text;
END $$;
REVOKE ALL ON FUNCTION public.complete_attachment_upload(uuid,uuid,text,text,bigint,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.complete_attachment_upload(uuid,uuid,text,text,bigint,text) TO ams_runtime;

-- Pending and rejected objects are not even metadata-readable as trusted evidence.
CREATE OR REPLACE FUNCTION finance_private.can_read_attachment(p_organization_id uuid,p_attachment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT finance_private.has_permission(p_organization_id,'attachments.read') AND EXISTS(
  SELECT 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id AND a.scan_status='clean'
   AND NOT EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id
    AND NOT finance_private.can_read_document(l.organization_id,l.document_id))
   AND (EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id)
    OR (finance_private.has_permission(a.organization_id,'attachments.write') AND EXISTS(
      SELECT 1 FROM finance.organization_members m WHERE m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
       AND m.user_id=identity.current_actor_id() AND m.status='active'))))
$$;
