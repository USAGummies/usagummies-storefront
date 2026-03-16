-- Email command execution quality evaluations
CREATE TABLE IF NOT EXISTS public.abra_command_evals (
  id TEXT PRIMARY KEY DEFAULT 'eval-' || substr(md5(random()::text), 1, 12),
  command_id TEXT NOT NULL REFERENCES public.abra_email_commands(id),

  -- Scoring dimensions (0.0 to 1.0)
  task_understanding REAL,      -- Did Abra correctly understand what was asked?
  execution_quality REAL,       -- Were the right tools called with correct params?
  reply_quality REAL,           -- Was the draft reply professional and accurate?
  overall_score REAL,           -- Weighted composite

  -- Feedback
  human_rating INTEGER,         -- 1-5 manual rating from Ben (optional)
  human_feedback TEXT,          -- Free-text feedback
  auto_eval_reasoning TEXT,     -- LLM's reasoning for the scores

  -- Meta
  model_used TEXT,
  tool_calls_count INTEGER DEFAULT 0,
  total_tokens INTEGER,
  latency_ms INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_evals_command ON public.abra_command_evals(command_id);
CREATE INDEX IF NOT EXISTS idx_command_evals_score ON public.abra_command_evals(overall_score);

-- Prompt evolution tracking
CREATE TABLE IF NOT EXISTS public.abra_prompt_versions (
  id TEXT PRIMARY KEY DEFAULT 'prompt-' || substr(md5(random()::text), 1, 12),
  prompt_type TEXT NOT NULL DEFAULT 'email_command',
  version INTEGER NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  avg_score REAL,
  eval_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON public.abra_prompt_versions(prompt_type, active);

-- RLS
ALTER TABLE public.abra_command_evals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_evals" ON public.abra_command_evals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.abra_prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_prompts" ON public.abra_prompt_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
