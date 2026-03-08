-- Migration: Fix missing email_events columns (rolled back in 20260308000000)
-- and relax NOT NULL constraints for W10/W02 workflow compatibility.

-- ============================================================
-- 1. email_events — re-add columns that were rolled back
-- ============================================================
ALTER TABLE email_events
  ADD COLUMN IF NOT EXISTS classifying_worker_id text,
  ADD COLUMN IF NOT EXISTS classification_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS secondary_categories text[],
  ADD COLUMN IF NOT EXISTS classification_confidence numeric,
  ADD COLUMN IF NOT EXISTS needs_human_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_action text,
  ADD COLUMN IF NOT EXISTS routed_agent_ids uuid[],
  ADD COLUMN IF NOT EXISTS open_brain_entry_ids uuid[],
  ADD COLUMN IF NOT EXISTS user_action text,
  ADD COLUMN IF NOT EXISTS user_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- ============================================================
-- 2. integration_health — relax NOT NULL on system_name
--    W10 workflow writes to service_name; system_name may be null
-- ============================================================
ALTER TABLE integration_health
  ALTER COLUMN system_name DROP NOT NULL;

-- Also relax connection_status NOT NULL (W10 uses 'status' column instead)
ALTER TABLE integration_health
  ALTER COLUMN connection_status DROP NOT NULL;

-- ============================================================
-- 3. approvals — relax NOT NULL on columns W02 may not provide
-- ============================================================
ALTER TABLE approvals
  ALTER COLUMN target_entity_type DROP NOT NULL;

ALTER TABLE approvals
  ALTER COLUMN target_entity_id DROP NOT NULL;

ALTER TABLE approvals
  ALTER COLUMN risk_level DROP NOT NULL;

ALTER TABLE approvals
  ALTER COLUMN permission_tier DROP NOT NULL;

-- Ensure action_type has a default for W02 compatibility
ALTER TABLE approvals
  ALTER COLUMN action_type SET DEFAULT 'email_action';

-- Ensure status has a default
ALTER TABLE approvals
  ALTER COLUMN status SET DEFAULT 'pending';

-- ============================================================
-- 4. Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
