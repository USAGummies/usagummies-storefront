ALTER TABLE public.abra_competitor_intel
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_intel_dedupe_key
  ON public.abra_competitor_intel (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
