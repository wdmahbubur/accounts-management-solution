-- US-071: request delivery of an already issued invoice's immutable PDF.
-- This appends communication state only; it never calls a posting command.
CREATE FUNCTION public.request_invoice_email_delivery(
  p_organization_id uuid,p_document_id uuid,p_pdf_version_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid:=identity.current_actor_id();
  v_member uuid;
  v_doc finance.business_documents%ROWTYPE;
  v_pdf finance.invoice_pdf_versions%ROWTYPE;
  v_recipient text;
  v_event_id uuid;
  v_delivery_id uuid;
  v_delivery_status text;
  v_deduplication_key text;
  v_payload jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' AND o.status<>'archived';
  IF v_member IS NULL OR NOT finance_private.has_permission(p_organization_id,'sales.write') THEN
    RAISE EXCEPTION 'invoice access unavailable' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'request id is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id
    AND d.id=p_document_id AND d.document_type='invoice' AND d.state='posted';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_pdf FROM finance.invoice_pdf_versions f WHERE f.organization_id=p_organization_id
    AND f.id=p_pdf_version_id AND f.document_id=p_document_id
    AND f.source_document_version=v_doc.version AND f.source_material_digest=v_doc.material_digest;
  IF NOT FOUND THEN RAISE EXCEPTION 'issued PDF version unavailable' USING ERRCODE='P0002'; END IF;
  IF jsonb_typeof(v_doc.party_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'issued customer recipient unavailable' USING ERRCODE='22023';
  END IF;
  v_recipient:=btrim(v_doc.party_snapshot->>'email');
  IF v_recipient IS NULL OR length(v_recipient)>320 OR v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'issued customer email is unavailable' USING ERRCODE='22023';
  END IF;
  v_deduplication_key:='invoice-send:'||p_document_id::text||':'||p_request_id::text;
  v_payload:=jsonb_build_object('pdf_version_id',v_pdf.id,'source_document_version',v_pdf.source_document_version,
    'source_material_digest',v_pdf.source_material_digest);
  v_event_id:=finance_private.enqueue_outbox_event(p_organization_id,'document.send_requested',p_document_id,
    v_deduplication_key,v_payload);
  INSERT INTO finance.notification_deliveries(organization_id,outbox_event_id,document_id,channel,recipient,status)
    VALUES(p_organization_id,v_event_id,p_document_id,'email',v_recipient,'queued')
    ON CONFLICT(organization_id,outbox_event_id,channel,recipient) DO NOTHING;
  SELECT nd.id,nd.status INTO v_delivery_id,v_delivery_status FROM finance.notification_deliveries nd
    WHERE nd.organization_id=p_organization_id AND nd.outbox_event_id=v_event_id AND nd.channel='email' AND nd.recipient=v_recipient;
  IF v_delivery_id IS NULL THEN RAISE EXCEPTION 'invoice delivery could not be recorded' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('outbox_event_id',v_event_id,'delivery_id',v_delivery_id,'status',v_delivery_status);
END $$;
REVOKE ALL ON FUNCTION public.request_invoice_email_delivery(uuid,uuid,uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.request_invoice_email_delivery(uuid,uuid,uuid,uuid) TO ams_runtime;

-- A transient delivery failure is reset only when its same leased event is claimed again.
CREATE FUNCTION finance_private.requeue_invoice_delivery_on_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.event_type='document.send_requested' AND NEW.status='processing' AND OLD.status IN ('pending','processing') THEN
    UPDATE finance.notification_deliveries nd SET status='queued',delivered_at=NULL,provider_message_id=NULL
      WHERE nd.organization_id=NEW.organization_id AND nd.outbox_event_id=NEW.id AND nd.channel='email' AND nd.status='failed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.requeue_invoice_delivery_on_claim() FROM PUBLIC,ams_runtime;
CREATE TRIGGER invoice_delivery_requeue_on_claim AFTER UPDATE OF status ON finance.outbox_events
  FOR EACH ROW WHEN (NEW.event_type='document.send_requested' AND NEW.status='processing')
  EXECUTE FUNCTION finance_private.requeue_invoice_delivery_on_claim();

-- Worker can read delivery metadata only while it owns the current event lease.
CREATE FUNCTION finance_private.read_claimed_invoice_delivery(p_event_id uuid,p_lease_token uuid)
RETURNS TABLE(organization_id uuid,document_id uuid,recipient text,pdf_version_id uuid,object_key text,
  download_filename text,sha256 text,byte_size bigint,source_document_version integer,source_material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY
  SELECT e.organization_id,e.document_id,nd.recipient,f.id,f.object_key,f.download_filename,f.sha256,f.byte_size,
    f.source_document_version,f.source_material_digest
  FROM finance.outbox_events e
  JOIN finance.business_documents d ON d.organization_id=e.organization_id AND d.id=e.document_id
    AND d.document_type='invoice' AND d.state='posted'
  JOIN finance.notification_deliveries nd ON nd.organization_id=e.organization_id AND nd.outbox_event_id=e.id
    AND nd.document_id=e.document_id AND nd.channel='email' AND nd.status='queued'
  JOIN finance.invoice_pdf_versions f ON f.organization_id=e.organization_id AND f.document_id=e.document_id
    AND f.id=(e.payload->>'pdf_version_id')::uuid
    AND f.source_document_version=d.version AND f.source_material_digest=d.material_digest
    AND f.source_document_version=(e.payload->>'source_document_version')::integer
    AND f.source_material_digest=e.payload->>'source_material_digest'
  WHERE e.id=p_event_id AND e.event_type='document.send_requested' AND e.status='processing'
    AND e.lease_token=p_lease_token AND e.lease_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice delivery lease unavailable' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.read_claimed_invoice_delivery(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_claimed_invoice_delivery(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
