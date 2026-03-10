-- Prompt 44: add Gmail message ID compatibility column and seed email feed

-- Keep provider_message_id as canonical dedup key while adding message_id for compatibility.
ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_message_id_unique
  ON public.email_events (message_id)
  WHERE message_id IS NOT NULL;

UPDATE public.email_events
SET message_id = provider_message_id
WHERE message_id IS NULL
  AND provider_message_id IS NOT NULL;

INSERT INTO public.abra_auto_teach_feeds (
  feed_key,
  feed_name,
  source,
  handler_endpoint,
  schedule_cron,
  is_active
)
VALUES (
  'email_fetch',
  'Gmail Email Fetch',
  'email',
  '/api/ops/abra/auto-teach?feed=email_fetch',
  '0 */4 * * *',
  true
)
ON CONFLICT (feed_key) DO UPDATE
SET
  feed_name = EXCLUDED.feed_name,
  source = EXCLUDED.source,
  handler_endpoint = EXCLUDED.handler_endpoint,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active = EXCLUDED.is_active,
  updated_at = now();
