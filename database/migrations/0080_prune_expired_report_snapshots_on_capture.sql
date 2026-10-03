-- Keep snapshot payload storage bounded for active report viewers even if the
-- scheduled export worker has not run. Worker cleanup remains the global sweep.
CREATE FUNCTION finance_private.prune_expired_report_export_snapshots()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  WITH expired AS (
    SELECT s.id FROM finance.report_export_snapshots s
    WHERE s.organization_id=NEW.organization_id
      AND s.created_by_member_id=NEW.created_by_member_id
      AND (s.expires_at<=clock_timestamp() OR s.revoked_at IS NOT NULL)
    ORDER BY s.expires_at,s.id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
  )
  DELETE FROM finance.report_export_snapshots s USING expired x WHERE s.id=x.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.prune_expired_report_export_snapshots() FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE TRIGGER report_export_snapshots_prune_expired
  AFTER INSERT ON finance.report_export_snapshots
  FOR EACH ROW EXECUTE FUNCTION finance_private.prune_expired_report_export_snapshots();
