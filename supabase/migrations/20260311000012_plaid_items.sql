-- Plaid Items — Durable token storage for bank connections
-- Backs up access tokens from Vercel KV so they survive KV eviction.
-- Single row expected (one Found.com connection) but supports future multi-bank.

CREATE TABLE IF NOT EXISTS plaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  institution_name TEXT DEFAULT 'Found',
  connected_by TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_webhook_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',  -- active | error | pending_reauth
  error_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (no user-facing queries)
CREATE POLICY "service_role_all" ON plaid_items
  FOR ALL USING (true);
