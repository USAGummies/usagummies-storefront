-- Prompt 32: register Amazon inventory feed for auto-teach scheduler

INSERT INTO public.abra_auto_teach_feeds (
  feed_key,
  feed_name,
  source,
  handler_endpoint,
  schedule_cron,
  is_active
)
VALUES
  ('amazon_inventory', 'Amazon FBA Inventory Feed', 'amazon', '/api/ops/abra/auto-teach?feed=amazon_inventory', '5 6 * * *', true)
ON CONFLICT (feed_key) DO UPDATE
SET
  feed_name = EXCLUDED.feed_name,
  source = EXCLUDED.source,
  handler_endpoint = EXCLUDED.handler_endpoint,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active = EXCLUDED.is_active,
  updated_at = now();
