-- Agent Performance Tracking — B5 build
-- Stores per-agent run results for health monitoring and auto-disable logic.
-- Note: ABRA8 syncs a separate Notion Agent Run Log; this table is the source
-- of truth for Supabase-side performance tracking.

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  agent_name TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  run_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_lookup
  ON agent_runs(engine_id, agent_key, run_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status
  ON agent_runs(status, run_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (no anon access)
CREATE POLICY "service_role_full"
  ON agent_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-cleanup: drop rows older than 30 days to keep the table lean.
-- Run manually or via pg_cron if available:
--   DELETE FROM agent_runs WHERE run_at < now() - interval '30 days';
