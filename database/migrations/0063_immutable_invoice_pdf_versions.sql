-- US-071: private, immutable PDFs bound to the exact posted source version.
CREATE TABLE finance.invoice_pdf_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  source_document_version integer NOT NULL CHECK (source_document_version > 0),
  source_material_digest text NOT NULL CHECK (source_material_digest ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL,
  download_filename text NOT NULL CHECK (download_filename ~ '^invoice-[0-9a-f-]{36}\.pdf$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,document_id,source_document_version),
  UNIQUE (organization_id,object_key),
  FOREIGN KEY (organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  CHECK (object_key=organization_id||'/invoice-pdfs/'||id)
);
CREATE INDEX invoice_pdf_versions_document_idx ON finance.invoice_pdf_versions(organization_id,document_id,created_at DESC);
ALTER TABLE finance.invoice_pdf_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.invoice_pdf_versions FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.reject_invoice_pdf_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'issued invoice PDF versions are immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION finance_private.reject_invoice_pdf_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER invoice_pdf_versions_append_only BEFORE UPDATE OR DELETE ON finance.invoice_pdf_versions
  FOR EACH ROW EXECUTE FUNCTION finance_private.reject_invoice_pdf_mutation();
CREATE TRIGGER invoice_pdf_versions_no_truncate BEFORE TRUNCATE ON finance.invoice_pdf_versions
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_invoice_pdf_mutation();

CREATE FUNCTION public.register_invoice_pdf_version(
  p_organization_id uuid,p_document_id uuid,p_pdf_id uuid,p_source_document_version integer,
  p_source_material_digest text,p_sha256 text,p_byte_size bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=identity.current_actor_id();v_member uuid;v_doc finance.business_documents%ROWTYPE;v_pdf finance.invoice_pdf_versions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' AND o.status<>'archived';
  IF v_member IS NULL OR NOT finance_private.has_permission(p_organization_id,'sales.read') THEN
    RAISE EXCEPTION 'invoice access unavailable' USING ERRCODE='42501'; END IF;
  IF p_pdf_id IS NULL OR p_source_document_version<1 OR p_source_material_digest !~ '^[0-9a-f]{64}$'
    OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_byte_size NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'invalid invoice PDF metadata' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id
    AND d.document_type='invoice' AND d.state='posted';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.version<>p_source_document_version OR v_doc.material_digest<>p_source_material_digest THEN
    RAISE EXCEPTION 'issued invoice changed during PDF generation' USING ERRCODE='40001'; END IF;
  INSERT INTO finance.invoice_pdf_versions(id,organization_id,document_id,source_document_version,source_material_digest,object_key,
    download_filename,sha256,byte_size,created_by_member_id)
    VALUES(p_pdf_id,p_organization_id,p_document_id,p_source_document_version,p_source_material_digest,
      p_organization_id||'/invoice-pdfs/'||p_pdf_id,'invoice-'||p_pdf_id||'.pdf',p_sha256,p_byte_size,v_member)
    ON CONFLICT(organization_id,document_id,source_document_version) DO NOTHING;
  SELECT * INTO v_pdf FROM finance.invoice_pdf_versions f WHERE f.organization_id=p_organization_id AND f.document_id=p_document_id
    AND f.source_document_version=p_source_document_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice PDF version could not be registered' USING ERRCODE='40001'; END IF;
  IF v_pdf.source_material_digest<>p_source_material_digest THEN
    RAISE EXCEPTION 'invoice version already has different PDF source' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('pdf_id',v_pdf.id,'object_key',v_pdf.object_key,'download_filename',v_pdf.download_filename,
    'sha256',v_pdf.sha256,'byte_size',v_pdf.byte_size,'source_document_version',v_pdf.source_document_version,
    'source_material_digest',v_pdf.source_material_digest);
END $$;
REVOKE ALL ON FUNCTION public.register_invoice_pdf_version(uuid,uuid,uuid,integer,text,text,bigint) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.register_invoice_pdf_version(uuid,uuid,uuid,integer,text,text,bigint) TO ams_runtime;

CREATE FUNCTION public.read_invoice_pdf_version(p_organization_id uuid,p_document_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_pdf finance.invoice_pdf_versions%ROWTYPE;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id
    AND d.document_type='invoice' AND d.state='posted';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_pdf FROM finance.invoice_pdf_versions f WHERE f.organization_id=p_organization_id AND f.document_id=p_document_id
    AND f.source_document_version=v_doc.version AND f.source_material_digest=v_doc.material_digest;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('pdf_id',v_pdf.id,'object_key',v_pdf.object_key,'download_filename',v_pdf.download_filename,
    'sha256',v_pdf.sha256,'byte_size',v_pdf.byte_size,'source_document_version',v_pdf.source_document_version,
    'source_material_digest',v_pdf.source_material_digest);
END $$;
REVOKE ALL ON FUNCTION public.read_invoice_pdf_version(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_invoice_pdf_version(uuid,uuid) TO ams_runtime;

CREATE OR REPLACE FUNCTION finance_private.can_download_artifact(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT identity.current_actor_id() IS NOT NULL AND (
    EXISTS(SELECT 1 FROM finance.attachments a JOIN finance.organizations o ON o.id=a.organization_id
      WHERE a.object_key=p_object_key AND a.object_key=a.organization_id||'/attachments/'||a.id
        AND o.status<>'archived' AND a.scan_status='clean' AND a.byte_size BETWEEN 1 AND 10485760
        AND finance_private.has_permission(a.organization_id,'attachments.read')
        AND NOT EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id
          AND NOT finance_private.can_read_document(l.organization_id,l.document_id))
        AND (EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id)
          OR (finance_private.has_permission(a.organization_id,'attachments.write') AND EXISTS(
            SELECT 1 FROM finance.organization_members m WHERE m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
              AND m.user_id=identity.current_actor_id() AND m.status='active'))))
    OR EXISTS(SELECT 1 FROM finance.export_jobs e JOIN finance.organizations o ON o.id=e.organization_id
      JOIN finance.organization_members m ON m.organization_id=e.organization_id AND m.id=e.requested_by_member_id
      WHERE e.object_key=p_object_key AND e.object_key=e.organization_id||'/exports/'||e.id
        AND m.user_id=identity.current_actor_id() AND m.status='active' AND o.status<>'archived'
        AND e.status='completed' AND e.expires_at>now() AND e.export_type='trial_balance'
        AND finance_private.has_permission(e.organization_id,'exports.read') AND finance_private.has_permission(e.organization_id,'reports.export')
        AND finance_private.has_permission(e.organization_id,'reports.read') AND finance_private.has_permission(e.organization_id,'accounting.read')
        AND finance_private.has_permission(e.organization_id,'ledger.read'))
    OR EXISTS(SELECT 1 FROM finance.invoice_pdf_versions f JOIN finance.organizations o ON o.id=f.organization_id
      JOIN finance.business_documents d ON d.organization_id=f.organization_id AND d.id=f.document_id
      WHERE f.object_key=p_object_key AND f.object_key=f.organization_id||'/invoice-pdfs/'||f.id AND o.status<>'archived'
        AND d.document_type='invoice' AND d.state='posted' AND d.version=f.source_document_version AND d.material_digest=f.source_material_digest
        AND f.byte_size BETWEEN 1 AND 10485760 AND finance_private.can_read_document(f.organization_id,f.document_id)
        AND finance_private.has_permission(f.organization_id,'sales.read'))
  )
$$;
REVOKE ALL ON FUNCTION finance_private.can_download_artifact(text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.can_download_artifact(text) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.authorize_artifact_download(p_organization_id uuid,p_kind text,p_artifact_id uuid)
RETURNS TABLE(object_key text,download_filename text,expected_size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text:=p_organization_id||'/'||p_kind||'/'||p_artifact_id;
BEGIN
  IF identity.current_actor_id() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('attachments','exports','invoice-pdfs') OR NOT finance_private.can_download_artifact(v_key) THEN
    RAISE EXCEPTION 'artifact unavailable' USING ERRCODE='P0002'; END IF;
  IF p_kind='attachments' THEN
    RETURN QUERY SELECT a.object_key,a.original_filename,a.byte_size FROM finance.attachments a
      WHERE a.organization_id=p_organization_id AND a.id=p_artifact_id;
  ELSIF p_kind='exports' THEN
    RETURN QUERY SELECT e.object_key,'export-'||e.id||'.'||e.format,NULL::bigint FROM finance.export_jobs e
      WHERE e.organization_id=p_organization_id AND e.id=p_artifact_id;
  ELSE
    RETURN QUERY SELECT f.object_key,f.download_filename,f.byte_size FROM finance.invoice_pdf_versions f
      WHERE f.organization_id=p_organization_id AND f.id=p_artifact_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
