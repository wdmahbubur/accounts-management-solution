-- US-071 regression: report export expansion in 0074 dropped issued invoice PDFs.
-- Preserve its attachment/export rules and restore the exact posted-version checks.
CREATE OR REPLACE FUNCTION finance_private.can_download_artifact(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT identity.current_actor_id() IS NOT NULL AND (
  EXISTS(SELECT 1 FROM finance.attachments a JOIN finance.organizations o ON o.id=a.organization_id
   WHERE a.object_key=p_object_key AND a.object_key=a.organization_id||'/attachments/'||a.id AND o.status<>'archived'
    AND a.scan_status='clean' AND a.byte_size BETWEEN 1 AND 10485760 AND finance_private.has_permission(a.organization_id,'attachments.read')
    AND NOT EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id
      AND NOT finance_private.can_read_document(l.organization_id,l.document_id))
    AND (EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id)
      OR (finance_private.has_permission(a.organization_id,'attachments.write') AND EXISTS(
       SELECT 1 FROM finance.organization_members m WHERE m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
        AND m.user_id=identity.current_actor_id() AND m.status='active'))))
  OR EXISTS(SELECT 1 FROM finance.export_jobs e JOIN finance.organizations o ON o.id=e.organization_id
    JOIN finance.organization_members m ON m.organization_id=e.organization_id AND m.id=e.requested_by_member_id
    WHERE e.object_key=p_object_key AND e.object_key=e.organization_id||'/exports/'||e.id AND e.output_size BETWEEN 1 AND 10485760
     AND e.output_sha256 IS NOT NULL AND m.user_id=identity.current_actor_id() AND m.status='active' AND o.status<>'archived'
     AND e.status='completed' AND e.expires_at>now() AND e.export_type IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement')
     AND finance_private.export_requester_authorized_for_type(e.organization_id,e.requested_by_member_id,e.export_type))
  OR EXISTS(SELECT 1 FROM finance.invoice_pdf_versions f JOIN finance.organizations o ON o.id=f.organization_id
    JOIN finance.business_documents d ON d.organization_id=f.organization_id AND d.id=f.document_id
    WHERE f.object_key=p_object_key AND f.object_key=f.organization_id||'/invoice-pdfs/'||f.id AND o.status<>'archived'
     AND d.document_type='invoice' AND d.state='posted' AND d.version=f.source_document_version AND d.material_digest=f.source_material_digest
     AND f.byte_size BETWEEN 1 AND 10485760 AND finance_private.can_read_document(f.organization_id,f.document_id)
     AND finance_private.has_permission(f.organization_id,'sales.read'))
 )
$$;
REVOKE ALL ON FUNCTION finance_private.can_download_artifact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_private.can_download_artifact(text) TO ams_runtime;
