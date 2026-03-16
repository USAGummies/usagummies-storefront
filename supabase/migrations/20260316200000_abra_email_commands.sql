-- Email-to-Abra command queue (replaces local JSON file)
-- Used by: scripts/usa-gummies-agentic.mjs (writer) + /api/ops/slack/abra (reader/executor)

CREATE TABLE IF NOT EXISTS public.abra_email_commands (
  id TEXT PRIMARY KEY,                    -- e.g. cmd-1773697695-dccetg
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'denied', 'executed', 'execution_failed')),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL,
  email_id TEXT,                           -- Gmail message ID
  body_snippet TEXT,
  result_text TEXT,                        -- Abra's response after execution
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abra_email_commands_status
  ON public.abra_email_commands(status);
CREATE INDEX IF NOT EXISTS idx_abra_email_commands_created
  ON public.abra_email_commands(created_at DESC);

-- RLS: service role only
ALTER TABLE public.abra_email_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.abra_email_commands
  FOR ALL USING (auth.role() = 'service_role');
