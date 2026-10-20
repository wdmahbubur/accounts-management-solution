-- Current identity schema uses normalized email and disabled_at.
-- Repair invitation issuance/resend and the member-revocation trigger without changing grants or posted facts.

CREATE OR REPLACE FUNCTION finance_private.verified_invitation_email() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;
BEGIN
  IF identity.current_actor_id() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT u.email_normalized INTO v_email FROM identity.users u
  WHERE u.id=identity.current_actor_id() AND u.email_verified_at IS NOT NULL
    AND u.disabled_at IS NULL;
  IF v_email IS NULL OR v_email='' THEN
    RAISE EXCEPTION 'verified email required' USING ERRCODE='42501';
  END IF;
  RETURN v_email;
END $$;
REVOKE ALL ON FUNCTION finance_private.verified_invitation_email() FROM PUBLIC,ams_runtime;

CREATE OR REPLACE FUNCTION public.issue_company_invitation(
  p_organization_id uuid,p_invitation_id uuid,p_email text,p_role_id uuid,
  p_token_hash text,p_delivery jsonb,p_request_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_email text:=lower(btrim(p_email)); v_own_email text; v_codes text[];
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor:=finance_private.require_capability(p_organization_id,'users.manage');
  PERFORM finance_private.require_recent_auth();
  v_own_email:=finance_private.verified_invitation_email();
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_invitation_id IS NULL OR v_email IS NULL OR length(v_email)>254
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid invitation input' USING ERRCODE='22023';
  END IF;
  IF v_email=v_own_email THEN RAISE EXCEPTION 'self invitation forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.roles r WHERE r.id=p_role_id AND r.organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'unknown role id' USING ERRCODE='22023';
  END IF;
  PERFORM finance_private.assert_roles_grantable(p_organization_id,v_actor,ARRAY[p_role_id]);
  v_codes:=finance_private.invitation_role_codes(p_organization_id,p_role_id);
  IF (SELECT count(*) FROM finance.audit_events a WHERE a.organization_id=p_organization_id
    AND a.action IN ('invitations.created','invitations.resent') AND a.created_at>now()-interval '1 hour')>=20 THEN
    RAISE EXCEPTION 'invitation rate limited' USING ERRCODE='P0429';
  END IF;
  IF EXISTS(SELECT 1 FROM finance.organization_members m JOIN identity.users u ON u.id=m.user_id
    WHERE m.organization_id=p_organization_id AND m.status='active' AND u.email_normalized=v_email) THEN
    RAISE EXCEPTION 'recipient already active' USING ERRCODE='23505';
  END IF;
  UPDATE finance.invitations SET status='expired',resolved_at=now()
  WHERE organization_id=p_organization_id AND email_normalized=v_email AND status='pending' AND expires_at<=now();
  INSERT INTO finance.invitations(id,organization_id,email_normalized,role_id,token_hash,expires_at,
    invited_by_member_id,permission_codes_snapshot)
  VALUES(p_invitation_id,p_organization_id,v_email,p_role_id,p_token_hash,now()+interval '72 hours',v_actor,v_codes);
  PERFORM finance_private.queue_invitation_delivery(p_organization_id,p_invitation_id,1,p_delivery);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'invitations.created','invitation',p_invitation_id,p_request_id,
    jsonb_build_object('role_id',p_role_id,'generation',1));
  RETURN p_invitation_id;
END $$;
REVOKE ALL ON FUNCTION public.issue_company_invitation(uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.issue_company_invitation(uuid,uuid,text,uuid,text,jsonb,text) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.resend_company_invitation(
  p_organization_id uuid,p_invitation_id uuid,p_token_hash text,p_delivery jsonb,p_request_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_inv finance.invitations%ROWTYPE; v_own_email text;
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor:=finance_private.require_capability(p_organization_id,'users.manage');
  PERFORM finance_private.require_recent_auth();
  v_own_email:=finance_private.verified_invitation_email();
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM finance_private.validate_request_id(p_request_id);
  SELECT * INTO v_inv FROM finance.invitations i
  WHERE i.id=p_invitation_id AND i.organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status NOT IN ('pending','expired') THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='P0002';
  END IF;
  IF v_inv.email_normalized=v_own_email THEN RAISE EXCEPTION 'self invitation forbidden' USING ERRCODE='42501'; END IF;
  PERFORM finance_private.assert_roles_grantable(p_organization_id,v_actor,ARRAY[v_inv.role_id]);
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_token_hash=v_inv.token_hash THEN
    RAISE EXCEPTION 'new invitation token required' USING ERRCODE='22023';
  END IF;
  IF v_inv.last_issued_at>now()-interval '60 seconds' OR
    (SELECT count(*) FROM finance.audit_events a WHERE a.organization_id=p_organization_id
      AND a.action IN ('invitations.created','invitations.resent') AND a.created_at>now()-interval '1 hour')>=20 THEN
    RAISE EXCEPTION 'invitation rate limited' USING ERRCODE='P0429';
  END IF;
  IF EXISTS(SELECT 1 FROM finance.organization_members m JOIN identity.users u ON u.id=m.user_id
    WHERE m.organization_id=p_organization_id AND m.status='active' AND u.email_normalized=v_inv.email_normalized) THEN
    RAISE EXCEPTION 'recipient already active' USING ERRCODE='23505';
  END IF;
  PERFORM finance_private.cancel_invitation_delivery(v_inv.id);
  UPDATE finance.invitations SET token_hash=p_token_hash,generation=generation+1,last_issued_at=now(),
    expires_at=now()+interval '72 hours',status='pending',resolved_at=NULL,invited_by_member_id=v_actor,
    permission_codes_snapshot=finance_private.invitation_role_codes(p_organization_id,v_inv.role_id)
  WHERE id=v_inv.id;
  PERFORM finance_private.queue_invitation_delivery(p_organization_id,v_inv.id,v_inv.generation+1,p_delivery);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'invitations.resent','invitation',v_inv.id,p_request_id,
    jsonb_build_object('role_id',v_inv.role_id,'generation',v_inv.generation+1));
END $$;
REVOKE ALL ON FUNCTION public.resend_company_invitation(uuid,uuid,text,jsonb,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.resend_company_invitation(uuid,uuid,text,jsonb,text) TO ams_runtime;

CREATE OR REPLACE FUNCTION finance_private.invalidate_member_invitations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_email text;
BEGIN
  IF OLD.status='active' AND NEW.status='inactive' THEN
    PERFORM finance_private.lock_role_admin(NEW.organization_id);
    SELECT u.email_normalized INTO v_email FROM identity.users u WHERE u.id=NEW.user_id;
    FOR v_id IN UPDATE finance.invitations SET status='revoked',resolved_at=now()
      WHERE organization_id=NEW.organization_id AND status='pending'
        AND (invited_by_member_id=NEW.id OR email_normalized=v_email) RETURNING id
    LOOP
      PERFORM finance_private.cancel_invitation_delivery(v_id);
      INSERT INTO finance.audit_events(organization_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
      VALUES(NEW.organization_id,'system','invitations.invalidated','invitation',v_id,
        'membership_revocation',jsonb_build_object('member_id',NEW.id,'reason','membership revoked'));
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.invalidate_member_invitations() FROM PUBLIC,ams_runtime;
