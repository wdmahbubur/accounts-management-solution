-- US-011: fail-closed tenant and capability surface. CLI-generated migration.
BEGIN;
REVOKE CREATE ON SCHEMA public,finance,finance_private FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON ALL TABLES IN SCHEMA finance FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA finance FROM PUBLIC,anon,authenticated;

-- This role cannot log in, inherit user privileges or bypass RLS. Future worker
-- commands must grant only their reviewed, organization-scoped leased operation.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ams_job_worker') THEN
    CREATE ROLE ams_job_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ams_job_worker' AND
    (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe pre-existing worker role';
  END IF;
END $$;
REVOKE ALL ON SCHEMA finance,finance_private FROM ams_job_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM ams_job_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance_private FROM ams_job_worker;

CREATE FUNCTION finance_private.active_tenant(p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=auth.uid()
      AND m.status='active' AND o.status<>'archived')
$$;
REVOKE ALL ON FUNCTION finance_private.active_tenant(uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.active_tenant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION finance_private.has_permission(p_organization_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT finance_private.active_tenant(p_organization_id) AND EXISTS(
    SELECT 1 FROM finance.organization_members m
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
    JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
    JOIN finance.permissions p ON p.id=rp.permission_id
    WHERE m.organization_id=p_organization_id AND m.user_id=auth.uid() AND m.status='active' AND p.code=p_permission)
$$;
CREATE OR REPLACE FUNCTION finance_private.member_has_capability(p_organization_id uuid,p_member_id uuid,p_permission_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM finance.organization_members m
    JOIN finance.organizations o ON o.id=m.organization_id
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
    JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
    JOIN finance.permissions p ON p.id=rp.permission_id
    WHERE m.organization_id=p_organization_id AND m.id=p_member_id AND m.status='active'
      AND o.status<>'archived' AND p.code=p_permission_code)
$$;
REVOKE ALL ON FUNCTION finance_private.member_has_capability(uuid,uuid,text) FROM PUBLIC,anon,authenticated,ams_job_worker;

-- Restrictive predicates combine with (rather than replace) module permissions.
-- Even an accidentally broad future permissive read policy cannot cross tenants.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='finance' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY',t.relname);
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='finance' AND table_name=t.relname AND column_name='organization_id') THEN
      EXECUTE format('CREATE POLICY active_tenant_fence ON finance.%I AS RESTRICTIVE FOR ALL TO authenticated USING (finance_private.active_tenant(organization_id)) WITH CHECK (finance_private.active_tenant(organization_id))',t.relname);
    END IF;
  END LOOP;
END $$;
CREATE POLICY active_tenant_fence ON finance.organizations AS RESTRICTIVE FOR ALL TO authenticated
USING(finance_private.active_tenant(id)) WITH CHECK(finance_private.active_tenant(id));

-- Names/metadata are sensitive too: a readable AR link cannot launder vendor
-- evidence also linked to an unreadable AP source.
CREATE OR REPLACE FUNCTION finance_private.can_read_attachment(p_organization_id uuid,p_attachment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT finance_private.has_permission(p_organization_id,'attachments.read') AND EXISTS(
    SELECT 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
      AND NOT EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id
        AND NOT finance_private.can_read_document(l.organization_id,l.document_id))
      AND (EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id)
        OR (finance_private.has_permission(a.organization_id,'attachments.write') AND EXISTS(
          SELECT 1 FROM finance.organization_members m WHERE m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
            AND m.user_id=auth.uid() AND m.status='active'))))
$$;
DROP POLICY export_jobs_read ON finance.export_jobs;
CREATE POLICY export_jobs_read ON finance.export_jobs FOR SELECT TO authenticated
USING(finance_private.has_permission(organization_id,'exports.read') AND EXISTS(
  SELECT 1 FROM finance.organization_members m WHERE m.organization_id=export_jobs.organization_id
    AND m.id=export_jobs.requested_by_member_id AND m.user_id=auth.uid() AND m.status='active'));

-- Caller RLS applies to a deliberately minimal read model; no party snapshot,
-- object key, audit payload or broad report totals are embedded in this view.
CREATE VIEW finance.document_directory WITH(security_invoker=true,security_barrier=true) AS
SELECT id,organization_id,document_type::text AS document_type,state::text AS state,
  document_number,accounting_date,total_amount::numeric(20,2)::text AS total_amount
FROM finance.business_documents;
REVOKE ALL ON finance.document_directory FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT SELECT ON finance.document_directory TO authenticated;
CREATE FUNCTION public.read_document_directory(p_organization_id uuid,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL)
RETURNS SETOF finance.document_directory LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid directory page size' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT * FROM finance.document_directory d WHERE d.organization_id=p_organization_id
    AND (p_after IS NULL OR d.id>p_after) ORDER BY d.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_document_directory(uuid,integer,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_document_directory(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
