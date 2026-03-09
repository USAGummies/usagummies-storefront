BEGIN;

-- ============================================================
-- Prompt 3.5 Stabilization: approvals + integration_health
-- ============================================================

-- 1) approvals: persist approval trigger for auditability
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS approval_trigger TEXT;

ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_approval_trigger_check;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_approval_trigger_check
  CHECK (
    approval_trigger IS NULL OR approval_trigger IN (
      'distributor_response',
      'payment_issue',
      'production_decision',
      'external_response_draft',
      'commitment',
      'none',
      'regulatory_flag',
      'inventory_reorder',
      'pricing_change',
      'new_partnership',
      'legal_notice'
    )
  );

-- 2) approvals dedupe for workflow upsert-on-conflict
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approvals_email_action_status_key'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_email_action_status_key
      UNIQUE (target_entity_type, target_entity_id, action_type, status);
  END IF;
END $$;

-- 3) integration_health canonical compatibility
ALTER TABLE public.integration_health
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS response_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_by UUID;

-- Backfill canonical + compatibility columns
UPDATE public.integration_health
SET
  service_name = COALESCE(service_name, system_name),
  system_name = COALESCE(system_name, service_name),
  status = COALESCE(
    status,
    CASE
      WHEN connection_status IN ('connected', 'healthy') THEN 'healthy'
      WHEN connection_status = 'not_configured' THEN 'not_configured'
      WHEN connection_status IN ('error', 'degraded', 'down', 'expired') THEN 'error'
      ELSE 'not_configured'
    END
  ),
  connection_status = COALESCE(
    connection_status,
    CASE
      WHEN COALESCE(status, 'not_configured') = 'healthy' THEN 'connected'
      WHEN COALESCE(status, 'not_configured') = 'not_configured' THEN 'not_configured'
      ELSE 'error'
    END
  )
WHERE
  service_name IS NULL
  OR system_name IS NULL
  OR status IS NULL
  OR connection_status IS NULL;

-- enforce allowed status values
ALTER TABLE public.integration_health
  DROP CONSTRAINT IF EXISTS integration_health_status_check;

ALTER TABLE public.integration_health
  ADD CONSTRAINT integration_health_status_check
  CHECK (status IS NULL OR status IN ('healthy', 'degraded', 'error', 'not_configured'));

-- ensure unique key for service_name upsert path
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integration_health_service_name_key'
      AND conrelid = 'public.integration_health'::regclass
  ) THEN
    ALTER TABLE public.integration_health
      ADD CONSTRAINT integration_health_service_name_key UNIQUE (service_name);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
