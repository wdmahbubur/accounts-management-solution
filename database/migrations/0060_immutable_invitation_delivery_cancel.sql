-- Preserve immutable encrypted outbox payloads when an invitation is resent or revoked.
CREATE OR REPLACE FUNCTION finance_private.cancel_invitation_delivery(p_invitation_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE finance.outbox_events SET status='failed',lease_until=NULL,lease_token=NULL,
    last_error_code='INVITATION_SUPERSEDED'
  WHERE event_type='invitation.send' AND payload->>'invitation_id'=p_invitation_id::text
    AND status IN ('pending','processing')
$$;
REVOKE ALL ON FUNCTION finance_private.cancel_invitation_delivery(uuid) FROM PUBLIC,ams_runtime;
