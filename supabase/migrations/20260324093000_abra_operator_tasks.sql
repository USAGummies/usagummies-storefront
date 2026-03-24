CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.abra_operator_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT,
  assigned_to TEXT,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approval_id UUID,
  execution_params JSONB,
  execution_result JSONB,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_by TIMESTAMPTZ,
  depends_on UUID[],
  tags TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_status_created_at
  ON public.abra_operator_tasks(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_task_type_status
  ON public.abra_operator_tasks(task_type, status);

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_due_by
  ON public.abra_operator_tasks(due_by)
  WHERE due_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_requires_approval
  ON public.abra_operator_tasks(requires_approval, status);

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_tags_gin
  ON public.abra_operator_tasks
  USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_abra_operator_tasks_execution_params_gin
  ON public.abra_operator_tasks
  USING GIN(execution_params);
