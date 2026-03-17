-- Abra Event Bus — Cross-department event log for audit trail and replay
-- Events are fire-and-forget: this table is for observability, not execution.

CREATE TABLE IF NOT EXISTS abra_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  department TEXT NOT NULL,
  source_action TEXT,
  source_approval_id TEXT,
  payload JSONB DEFAULT '{}',
  handlers_run INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_event_log_type ON abra_event_log(event_type);
CREATE INDEX idx_event_log_dept ON abra_event_log(department);
CREATE INDEX idx_event_log_created ON abra_event_log(created_at DESC);

-- Error tracking table for Phase 6B
CREATE TABLE IF NOT EXISTS abra_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_hash TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  source TEXT NOT NULL,
  severity TEXT DEFAULT 'error',
  metadata JSONB DEFAULT '{}',
  occurrence_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX idx_abra_errors_hash ON abra_errors(error_hash);
CREATE INDEX idx_abra_errors_unresolved ON abra_errors(resolved, last_seen_at DESC) WHERE resolved = false;
