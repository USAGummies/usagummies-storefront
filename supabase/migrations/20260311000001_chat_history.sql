CREATE TABLE IF NOT EXISTS public.abra_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL DEFAULT 'ben@usagummies.com',
  thread_id UUID NOT NULL DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  model_used TEXT,
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_thread
  ON public.abra_chat_history(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_history_user
  ON public.abra_chat_history(user_email, created_at DESC);
