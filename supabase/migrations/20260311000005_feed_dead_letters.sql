-- Prompt 46: dead letter queue for feed failures + failure tracking column

CREATE TABLE IF NOT EXISTS public.abra_feed_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key TEXT NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  feed_snapshot JSONB,
  retry_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_dead_letters_unresolved
  ON public.abra_feed_dead_letters(feed_key, resolved)
  WHERE NOT resolved;

ALTER TABLE public.abra_auto_teach_feeds
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_status TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT;
