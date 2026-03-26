CREATE TABLE IF NOT EXISTS public.abra_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version TEXT NOT NULL,
  total_queries INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  avg_ms_quick NUMERIC,
  avg_ms_finance NUMERIC,
  avg_ms_knowledge NUMERIC,
  avg_ms_action NUMERIC,
  red_lines_crossed TEXT[],
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abra_evaluation_runs_created_at
  ON public.abra_evaluation_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_abra_evaluation_runs_prompt_version
  ON public.abra_evaluation_runs(prompt_version);
