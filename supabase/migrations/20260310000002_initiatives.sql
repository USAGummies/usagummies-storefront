-- Abra v2: Initiative System, Sessions, Cost Tracking
-- Adds tables for department initiatives, meeting sessions, and AI cost logging.
-- Also extends abra_departments with dashboard/priority config.

-- 1. abra_initiatives — High-level department goals/projects
CREATE TABLE IF NOT EXISTS public.abra_initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  title TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'researching'
    CHECK (status IN ('researching','planning','asking_questions','approved','executing','paused','completed')),
  baseline_requirements JSONB DEFAULT '[]'::jsonb,
  custom_requirements JSONB DEFAULT '[]'::jsonb,
  questions JSONB DEFAULT '[]'::jsonb,
  answers JSONB DEFAULT '{}'::jsonb,
  tasks JSONB DEFAULT '[]'::jsonb,
  kpis JSONB DEFAULT '[]'::jsonb,
  research_findings JSONB DEFAULT '[]'::jsonb,
  initiated_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_initiatives_department ON public.abra_initiatives(department);
CREATE INDEX IF NOT EXISTS idx_initiatives_status ON public.abra_initiatives(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_initiatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_initiatives_updated_at ON public.abra_initiatives;
CREATE TRIGGER trg_initiatives_updated_at
  BEFORE UPDATE ON public.abra_initiatives
  FOR EACH ROW EXECUTE FUNCTION public.set_initiatives_updated_at();

-- RLS
ALTER TABLE public.abra_initiatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_initiatives" ON public.abra_initiatives
  FOR ALL USING (true) WITH CHECK (true);


-- 2. abra_sessions — Meeting/session tracking
CREATE TABLE IF NOT EXISTS public.abra_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT,
  initiative_id UUID REFERENCES public.abra_initiatives(id) ON DELETE SET NULL,
  session_type TEXT NOT NULL DEFAULT 'meeting'
    CHECK (session_type IN ('meeting','review','teaching','research','planning')),
  title TEXT,
  agenda JSONB DEFAULT '[]'::jsonb,
  notes JSONB DEFAULT '[]'::jsonb,
  action_items JSONB DEFAULT '[]'::jsonb,
  decisions JSONB DEFAULT '[]'::jsonb,
  open_questions JSONB DEFAULT '[]'::jsonb,
  user_email TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_department ON public.abra_sessions(department);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.abra_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_initiative ON public.abra_sessions(initiative_id);

ALTER TABLE public.abra_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_sessions" ON public.abra_sessions
  FOR ALL USING (true) WITH CHECK (true);


-- 3. abra_cost_log — AI spend tracking
CREATE TABLE IF NOT EXISTS public.abra_cost_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  endpoint TEXT,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_log_created ON public.abra_cost_log(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_log_provider ON public.abra_cost_log(provider);

ALTER TABLE public.abra_cost_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_cost_log" ON public.abra_cost_log
  FOR ALL USING (true) WITH CHECK (true);

-- RPC: Get monthly AI spend
CREATE OR REPLACE FUNCTION public.get_monthly_ai_spend(
  target_month TEXT DEFAULT NULL  -- 'YYYY-MM' format, defaults to current month
)
RETURNS TABLE(
  month TEXT,
  total_cost NUMERIC,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  call_count BIGINT,
  by_provider JSONB,
  by_endpoint JSONB
) AS $$
DECLARE
  m TEXT := COALESCE(target_month, to_char(now(), 'YYYY-MM'));
BEGIN
  RETURN QUERY
  SELECT
    m AS month,
    COALESCE(SUM(c.estimated_cost_usd), 0) AS total_cost,
    COALESCE(SUM(c.input_tokens)::BIGINT, 0) AS total_input_tokens,
    COALESCE(SUM(c.output_tokens)::BIGINT, 0) AS total_output_tokens,
    COUNT(*)::BIGINT AS call_count,
    COALESCE(
      jsonb_object_agg(sub_p.provider, sub_p.cost) FILTER (WHERE sub_p.provider IS NOT NULL),
      '{}'::jsonb
    ) AS by_provider,
    COALESCE(
      jsonb_object_agg(sub_e.endpoint, sub_e.cost) FILTER (WHERE sub_e.endpoint IS NOT NULL),
      '{}'::jsonb
    ) AS by_endpoint
  FROM public.abra_cost_log c
  LEFT JOIN LATERAL (
    SELECT c2.provider, SUM(c2.estimated_cost_usd) AS cost
    FROM public.abra_cost_log c2
    WHERE to_char(c2.created_at, 'YYYY-MM') = m
    GROUP BY c2.provider
  ) sub_p ON true
  LEFT JOIN LATERAL (
    SELECT c3.endpoint, SUM(c3.estimated_cost_usd) AS cost
    FROM public.abra_cost_log c3
    WHERE to_char(c3.created_at, 'YYYY-MM') = m
    GROUP BY c3.endpoint
  ) sub_e ON true
  WHERE to_char(c.created_at, 'YYYY-MM') = m;
END;
$$ LANGUAGE plpgsql;


-- 4. Extend abra_departments with dashboard/priority config
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'dashboard_config'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN dashboard_config JSONB DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'current_priorities'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN current_priorities JSONB DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'long_term_goals'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN long_term_goals JSONB DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'short_term_goals'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN short_term_goals JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;
