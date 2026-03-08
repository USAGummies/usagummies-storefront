-- Migration: Update CHECK constraints for W01/W02/W10 workflow compatibility
-- Prompt 1 constraints were too restrictive for Build Prompt 2 workflows.

-- ============================================================
-- 1. email_events.status — add 'classifying' and 'classified'
-- ============================================================
-- Drop the existing CHECK (auto-named as email_events_status_check)
ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_status_check;
-- Re-add with expanded values
ALTER TABLE email_events ADD CONSTRAINT email_events_status_check
  CHECK (status IN ('new', 'classifying', 'classified', 'triaged', 'actioned', 'archived', 'error'));

-- ============================================================
-- 2. approvals.action_type — add W02 action types
-- ============================================================
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_action_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_action_type_check
  CHECK (action_type IN (
    'send_email', 'auto_reply', 'escalation', 'update_listing',
    'place_order', 'contact_distributor', 'commit_funds',
    'update_pricing', 'schedule_production', 'data_mutation', 'other'
  ));

-- ============================================================
-- 3. integration_health.connection_status — add W10 statuses
-- ============================================================
ALTER TABLE integration_health DROP CONSTRAINT IF EXISTS integration_health_connection_status_check;
ALTER TABLE integration_health ADD CONSTRAINT integration_health_connection_status_check
  CHECK (connection_status IS NULL OR connection_status IN (
    'connected', 'expired', 'error', 'not_configured', 'healthy', 'degraded', 'down'
  ));

-- ============================================================
-- 4. Reload schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
