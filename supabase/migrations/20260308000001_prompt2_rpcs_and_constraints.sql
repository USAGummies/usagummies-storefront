-- ============================================================
-- Abra OS — Prompt 2 RPCs and Constraints (Fixed)
-- Column mapping:
--   integration_health: system_name (existing) + add service_name,
--     response_ms, last_error, details, checked_at, checked_by
--   approvals: already has action_type, status, confidence, risk_level
-- ============================================================

-- 1. Drop existing functions (old param names from Prompt 1)
DROP FUNCTION IF EXISTS claim_email_events_for_classification(int, text);
DROP FUNCTION IF EXISTS release_stale_email_classification_locks(int);

-- 2. Recreate claim_email_events_for_classification
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

-- 3. Recreate release_stale_email_classification_locks
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

-- 4. Add W10-compatible columns to integration_health
--    The W10 workflow writes: service_name, status, response_ms, last_error, details, checked_at, checked_by
--    Existing columns: system_name, connection_status, last_success_at, last_error_at, error_summary, ...
ALTER TABLE integration_health
  ADD COLUMN IF NOT EXISTS service_name text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS response_ms int,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS details text,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_by uuid;

-- Unique constraint on service_name for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_health_service_name_key'
  ) THEN
    ALTER TABLE integration_health
      ADD CONSTRAINT integration_health_service_name_key UNIQUE (service_name);
  END IF;
END $$;

-- 5. Add W02-compatible columns to approvals if missing
--    W02 writes: requesting_agent_id, action_type (exists), action_proposed,
--    confidence_level, risk_assessment, status (exists)
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS action_proposed text,
  ADD COLUMN IF NOT EXISTS confidence_level numeric,
  ADD COLUMN IF NOT EXISTS risk_assessment text;

-- 6. Grant RPC execute permissions
GRANT EXECUTE ON FUNCTION claim_email_events_for_classification(int, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_email_events_for_classification(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION release_stale_email_classification_locks(int) TO service_role;
GRANT EXECUTE ON FUNCTION release_stale_email_classification_locks(int) TO authenticated;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
