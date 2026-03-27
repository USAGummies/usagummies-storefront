CREATE TABLE IF NOT EXISTS public.abra_slack_dedup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL,
  dedup_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abra_slack_dedup_key_time
  ON public.abra_slack_dedup (dedup_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_abra_slack_dedup_type_time
  ON public.abra_slack_dedup (dedup_type, created_at DESC);
