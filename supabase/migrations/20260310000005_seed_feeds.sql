-- Prompt 16: seed Abra auto-teach feeds

CREATE TABLE IF NOT EXISTS public.abra_auto_teach_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key TEXT UNIQUE NOT NULL,
  feed_name TEXT NOT NULL,
  source TEXT NOT NULL,
  handler_endpoint TEXT NOT NULL,
  schedule_cron TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abra_auto_teach_feeds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'abra_auto_teach_feeds'
      AND policyname = 'service_role_auto_teach_feeds'
  ) THEN
    CREATE POLICY "service_role_auto_teach_feeds"
      ON public.abra_auto_teach_feeds
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.abra_auto_teach_feeds (
  feed_key,
  feed_name,
  source,
  handler_endpoint,
  schedule_cron,
  is_active
)
VALUES
  ('amazon_orders', 'Amazon Orders Feed', 'amazon', '/api/ops/abra/auto-teach?feed=amazon_orders', '0 6 * * *', true),
  ('faire_orders', 'Faire Orders Feed', 'faire', '/api/ops/abra/auto-teach?feed=faire_orders', '10 6 * * *', true),
  ('shopify_products', 'Shopify Products Feed', 'shopify', '/api/ops/abra/auto-teach?feed=shopify_products', '20 6 * * *', true),
  ('ga4_traffic', 'GA4 Traffic Feed', 'ga4', '/api/ops/abra/auto-teach?feed=ga4_traffic', '0 22 * * *', true),
  ('inventory_alerts', 'Inventory Alerts Feed', 'inventory', '/api/ops/abra/auto-teach?feed=inventory_alerts', '30 6 * * *', true)
ON CONFLICT (feed_key) DO UPDATE
SET
  feed_name = EXCLUDED.feed_name,
  source = EXCLUDED.source,
  handler_endpoint = EXCLUDED.handler_endpoint,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active = EXCLUDED.is_active,
  updated_at = now();
