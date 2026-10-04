-- US-069/US-070/US-073: internal jobs use a credential separate from app requests.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='ams_job_worker_login') THEN
    CREATE ROLE ams_job_worker_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='ams_job_worker_login' AND
    (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe pre-existing worker login role';
  END IF;
END $$;
ALTER ROLE ams_job_worker_login SET search_path='';
ALTER ROLE ams_job_worker_login SET statement_timeout='30s';
GRANT ams_job_worker TO ams_job_worker_login;
GRANT USAGE ON SCHEMA finance_private TO ams_job_worker;

REVOKE ALL ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.complete_outbox_delivery(uuid,uuid,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.fail_outbox_delivery(uuid,uuid,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.read_outbox_dead_letters(integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.complete_outbox_delivery(uuid,uuid,text) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.fail_outbox_delivery(uuid,uuid,text) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.read_outbox_dead_letters(integer) TO ams_job_worker;

REVOKE ALL ON FUNCTION finance_private.read_claimed_invoice_delivery(uuid,uuid) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.read_claimed_financial_reminder(uuid,uuid) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.enqueue_due_notification_reminders() FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_claimed_invoice_delivery(uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.read_claimed_financial_reminder(uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.enqueue_due_notification_reminders() TO ams_job_worker;

REVOKE ALL ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.read_trial_balance_export(uuid,uuid) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.read_report_export_snapshot(uuid,uuid) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.read_trial_balance_export(uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.read_report_export_snapshot(uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) TO ams_job_worker;
NOTIFY pgrst,'reload schema';
