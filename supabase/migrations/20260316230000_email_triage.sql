-- Email triage results from proactive Abra monitoring
CREATE TABLE IF NOT EXISTS public.abra_email_triage (
  id TEXT PRIMARY KEY DEFAULT 'triage-' || substr(md5(random()::text), 1, 12),
  email_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'informational'
    CHECK (category IN ('urgent', 'action_needed', 'informational', 'routine', 'spam')),
  summary TEXT,
  suggested_action TEXT,
  auto_handled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_triage_category ON public.abra_email_triage(category);
CREATE INDEX IF NOT EXISTS idx_email_triage_created ON public.abra_email_triage(created_at DESC);

-- RLS
ALTER TABLE public.abra_email_triage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_triage" ON public.abra_email_triage
  FOR ALL TO service_role USING (true) WITH CHECK (true);
