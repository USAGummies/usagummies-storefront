CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  current_step_index INTEGER NOT NULL DEFAULT 0,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON public.workflow_runs(status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id
  ON public.workflow_runs(workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at
  ON public.workflow_runs(started_at DESC);
