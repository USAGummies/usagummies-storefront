-- ============================================================
-- Abra OS — Prompt 2 Schema Patch
-- Adds classification columns to email_events,
-- creates RPCs for atomic locking, and adds integration_health
-- columns for W10 health check upsert.
-- ============================================================

-- 1. Add classification / locking columns to email_events
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

-- 2. Index for classification lock queries
CREATE INDEX IF NOT EXISTS idx_email_events_classifying
  ON email_events (status, classifying_worker_id)
  WHERE status = 'new' OR status = 'classifying';

-- 3. RPC: claim_email_events_for_classification
--    Drop first to handle param name changes from Prompt 1
DROP FUNCTION IF EXISTS claim_email_events_for_classification(int, text);
--    Atomically claims a batch of unclassified emails using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_email_events_for_classification(
  batch_size int DEFAULT 10,
  worker_id text DEFAULT 'default'
)
RETURNS SETOF email_events
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM email_events
    WHERE status = 'new'
      AND classifying_worker_id IS NULL
    ORDER BY received_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE email_events e
  SET
    status = 'classifying',
    classifying_worker_id = worker_id,
    classification_started_at = now()
  FROM claimed c
  WHERE e.id = c.id
  RETURNING e.*;
END;
$$;

-- 4. RPC: release_stale_email_classification_locks
--    Drop first to handle param name changes from Prompt 1
DROP FUNCTION IF EXISTS release_stale_email_classification_locks(int);
--    Releases locks older than N minutes (default 15)
CREATE OR REPLACE FUNCTION release_stale_email_classification_locks(
  lock_timeout_minutes int DEFAULT 15
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  released_count int;
BEGIN
  UPDATE email_events
  SET
    status = 'new',
    classifying_worker_id = NULL,
    classification_started_at = NULL
  WHERE status = 'classifying'
    AND classification_started_at < (now() - (lock_timeout_minutes || ' minutes')::interval);

  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;

-- 5. Ensure integration_health has upsert-friendly unique constraint on service_name
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_health_service_name_key'
      AND conrelid = 'integration_health'::regclass
  ) THEN
    ALTER TABLE integration_health
      ADD CONSTRAINT integration_health_service_name_key UNIQUE (service_name);
  END IF;
END $$;

-- 6. Ensure approvals has required columns for W02 classifier
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS confidence_level numeric,
  ADD COLUMN IF NOT EXISTS risk_assessment text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- 7. Grant RPC execute to service_role and authenticated
GRANT EXECUTE ON FUNCTION claim_email_events_for_classification(int, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_email_events_for_classification(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION release_stale_email_classification_locks(int) TO service_role;
GRANT EXECUTE ON FUNCTION release_stale_email_classification_locks(int) TO authenticated;

-- 8. Reload PostgREST schema cache (notify triggers automatic reload)
NOTIFY pgrst, 'reload schema';
