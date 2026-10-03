-- US-067: permission-checked attachment metadata for the private evidence library.
-- This RPC intentionally returns metadata for pending/rejected objects, never object bytes or keys.
CREATE FUNCTION public.list_evidence_library(
  p_organization_id uuid,
  p_search text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  attachment_id uuid,
  filename text,
  content_type text,
  byte_size bigint,
  scan_status text,
  uploaded_at timestamptz,
  uploader text,
  source_id uuid,
  source_type text,
  source_number text,
  source_date date
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF identity.current_actor_id() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'attachments.read') THEN
    RAISE EXCEPTION 'attachment permission required' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to)
    OR p_search IS NOT NULL AND length(btrim(p_search))>120 THEN
    RAISE EXCEPTION 'invalid evidence filters' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT a.id,a.original_filename,a.content_type,a.byte_size,a.scan_status,a.created_at,
    m.display_name_snapshot,d.id,d.document_type::text,d.document_number,d.accounting_date
  FROM finance.attachments a
  JOIN finance.organization_members m ON m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
  JOIN finance.attachment_links l ON l.organization_id=a.organization_id AND l.attachment_id=a.id
  JOIN finance.business_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id
  WHERE a.organization_id=p_organization_id
    AND finance_private.has_permission(a.organization_id,'attachments.read')
    -- Do not reveal any part of an attachment linked to a source outside this actor's readable modules.
    AND NOT EXISTS(SELECT 1 FROM finance.attachment_links hidden
      WHERE hidden.organization_id=a.organization_id AND hidden.attachment_id=a.id
        AND NOT finance_private.can_read_document(hidden.organization_id,hidden.document_id))
    AND finance_private.can_read_document(d.organization_id,d.id)
    AND (p_from IS NULL OR (a.created_at AT TIME ZONE 'Asia/Dhaka')::date>=p_from)
    AND (p_to IS NULL OR (a.created_at AT TIME ZONE 'Asia/Dhaka')::date<=p_to)
    AND (p_search IS NULL OR btrim(p_search)='' OR a.original_filename ILIKE '%'||btrim(p_search)||'%'
      OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR d.document_type::text ILIKE '%'||btrim(p_search)||'%'
      OR m.display_name_snapshot ILIKE '%'||btrim(p_search)||'%')
  ORDER BY a.created_at DESC,a.id DESC,d.id
  OFFSET p_offset LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_evidence_library(uuid,text,date,date,integer,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_evidence_library(uuid,text,date,date,integer,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
