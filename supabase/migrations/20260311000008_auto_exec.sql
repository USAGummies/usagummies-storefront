ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS auto_executed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result JSONB;

CREATE INDEX IF NOT EXISTS idx_approvals_auto_exec_daily
  ON public.approvals(action_type, auto_executed, created_at)
  WHERE auto_executed = true;
