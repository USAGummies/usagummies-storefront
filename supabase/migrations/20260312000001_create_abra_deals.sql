-- Abra deals table for pipeline intelligence and deal seeding.
-- NOTE: migration file only; apply via `supabase db push` in deployment flow.

CREATE TABLE IF NOT EXISTS public.abra_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'prospecting',
  stage TEXT,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  department TEXT DEFAULT 'sales_and_growth',
  source TEXT DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abra_deals_status ON public.abra_deals(status);
CREATE INDEX IF NOT EXISTS idx_abra_deals_stage ON public.abra_deals(stage);
CREATE INDEX IF NOT EXISTS idx_abra_deals_updated_at ON public.abra_deals(updated_at DESC);

ALTER TABLE public.abra_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_abra_deals ON public.abra_deals;
CREATE POLICY service_role_abra_deals ON public.abra_deals
  FOR ALL USING (true) WITH CHECK (true);
