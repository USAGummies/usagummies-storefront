-- Email conversation threads for multi-turn Abra conversations
-- Tracks ongoing email threads so Abra has context across multiple messages

CREATE TABLE IF NOT EXISTS public.abra_email_threads (
  id TEXT PRIMARY KEY DEFAULT 'thread-' || substr(md5(random()::text), 1, 12),
  gmail_thread_id TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  subject_normalized TEXT NOT NULL DEFAULT '',  -- lowercase, stripped of Re:/Fwd: for grouping
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'waiting_reply', 'resolved', 'stale')),
  message_count INTEGER DEFAULT 1,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  context_summary TEXT,  -- Rolling summary of the conversation for LLM context
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link commands to threads
ALTER TABLE public.abra_email_commands
  ADD COLUMN IF NOT EXISTS thread_id TEXT REFERENCES public.abra_email_threads(id),
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_email_threads_gmail ON public.abra_email_threads(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_subject ON public.abra_email_threads(subject_normalized, sender_email);
CREATE INDEX IF NOT EXISTS idx_email_commands_thread ON public.abra_email_commands(thread_id);

-- RLS: service role only
ALTER TABLE public.abra_email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_threads" ON public.abra_email_threads
  FOR ALL TO service_role USING (true) WITH CHECK (true);
