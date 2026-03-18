-- Monthly close table — stores finalized P&L snapshots per period
CREATE TABLE IF NOT EXISTS monthly_close (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL UNIQUE,  -- "2026-02"
  status TEXT NOT NULL DEFAULT 'pending',
  report JSONB NOT NULL DEFAULT '{}',
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_close_period ON monthly_close(period);
CREATE INDEX IF NOT EXISTS idx_monthly_close_status ON monthly_close(status);

-- Auth audit log — tracks all authentication events
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,  -- login_success, login_failure, session_expired, role_check_denied
  user_email TEXT,
  user_id TEXT,
  user_role TEXT,
  ip_address TEXT,
  user_agent TEXT,
  route TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_event ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(user_email);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at DESC);
