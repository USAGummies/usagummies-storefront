CREATE TABLE IF NOT EXISTS public.abra_competitor_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_name TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (
    data_type IN ('pricing', 'product', 'promotion', 'review', 'market_position')
  ),
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT,
  source_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  department TEXT DEFAULT 'sales_and_growth',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_competitor_name
  ON public.abra_competitor_intel (competitor_name, created_at DESC);
