-- Morning Brief history table — stores daily brief snapshots for trend analysis
CREATE TABLE IF NOT EXISTS abra_morning_briefs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_at  timestamptz NOT NULL DEFAULT now(),

  -- Revenue snapshot
  shopify_revenue   numeric(12,2) DEFAULT 0,
  shopify_orders    integer DEFAULT 0,
  amazon_revenue    numeric(12,2) DEFAULT 0,
  amazon_orders     integer DEFAULT 0,
  combined_revenue  numeric(12,2) DEFAULT 0,
  combined_orders   integer DEFAULT 0,

  -- Action items
  pending_approvals integer DEFAULT 0,
  pipeline_moves    integer DEFAULT 0,
  unresolved_errors integer DEFAULT 0,
  critical_errors   integer DEFAULT 0,

  -- System status
  system_health     text DEFAULT 'operational',
  scheduled_agents  integer DEFAULT 0,

  -- Full content
  slack_text        text,
  raw_data          jsonb,

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Index on generated_at for fast lookups of recent briefs
CREATE INDEX IF NOT EXISTS idx_abra_morning_briefs_generated_at
  ON abra_morning_briefs (generated_at DESC);

-- RLS: service role only (no public access)
ALTER TABLE abra_morning_briefs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_all" ON abra_morning_briefs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
