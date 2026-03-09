-- ============================================================================
-- Abra OS — Core Schema Migration
-- Created: 2026-03-07
-- Description: 12 tables, seeds, triggers, functions, RLS, realtime
-- ============================================================================

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLE 1: users
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('founder', 'operator', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'disabled')),
  permission_profile TEXT NOT NULL DEFAULT 'viewer',
  default_view TEXT DEFAULT 'briefing',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed founder
INSERT INTO public.users (email, name, role, status, permission_profile, default_view)
VALUES ('ben@usagummies.com', 'Ben Stutman', 'founder', 'active', 'full_authority', 'briefing')
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- TABLE 2: agents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL
    CHECK (department IN (
      'executive', 'finance', 'operations', 'growth',
      'revenue', 'agent_resources', 'systems'
    )),
  level TEXT NOT NULL
    CHECK (level IN ('orchestrator', 'c_suite', 'sub_agent')),
  reports_to_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'not_built'
    CHECK (status IN ('not_built', 'in_development', 'deployed', 'paused')),
  deployment_type TEXT
    CHECK (deployment_type IN ('n8n_workflow', 'claude_api', 'manual')),
  workflow_key TEXT,
  system_prompt_version INTEGER DEFAULT 1,
  system_prompt TEXT,
  drift_score TEXT DEFAULT 'not_audited'
    CHECK (drift_score IN ('clean', 'minor_drift', 'needs_attention', 'not_audited')),
  phase TEXT
    CHECK (phase IN ('phase_1', 'phase_2', 'phase_3', 'phase_4')),
  identity_doc_notion_id TEXT,
  notes TEXT,
  last_audit_at TIMESTAMPTZ,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_department ON public.agents(department);
CREATE INDEX IF NOT EXISTS idx_agents_status ON public.agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_phase ON public.agents(phase);

-- Seed 9 agents
INSERT INTO public.agents (agent_name, department, level, status, phase, deployment_type) VALUES
  ('Abra', 'executive', 'orchestrator', 'in_development', 'phase_4', 'n8n_workflow'),
  ('Reporting Agent', 'systems', 'sub_agent', 'not_built', 'phase_1', 'n8n_workflow'),
  ('Company Finance Agent', 'finance', 'sub_agent', 'not_built', 'phase_2', 'n8n_workflow'),
  ('Deal Calculator Agent', 'finance', 'sub_agent', 'not_built', 'phase_2', 'n8n_workflow'),
  ('Distributor Pipeline Agent', 'revenue', 'sub_agent', 'not_built', 'phase_3', 'n8n_workflow'),
  ('Supply Chain Agent', 'operations', 'sub_agent', 'not_built', 'phase_4', 'n8n_workflow'),
  ('Amazon Optimization Agent', 'growth', 'sub_agent', 'not_built', 'phase_3', 'n8n_workflow'),
  ('Drift Audit Agent', 'agent_resources', 'sub_agent', 'not_built', 'phase_3', 'n8n_workflow'),
  ('Integration Agent', 'systems', 'sub_agent', 'not_built', 'phase_1', 'n8n_workflow')
ON CONFLICT (agent_name) DO NOTHING;

-- ============================================================================
-- TABLE 3: open_brain_entries
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.open_brain_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL DEFAULT 'agent'
    CHECK (source_type IN ('agent', 'email', 'manual', 'api', 'webhook')),
  source_ref TEXT,
  entry_type TEXT NOT NULL DEFAULT 'finding'
    CHECK (entry_type IN (
      'finding', 'research', 'field_note', 'summary',
      'alert', 'system_log'
    )),
  title TEXT,
  raw_text TEXT NOT NULL,
  summary_text TEXT,
  embedding VECTOR(1536),
  category TEXT NOT NULL
    CHECK (category IN (
      'market_intel', 'financial', 'operational', 'regulatory',
      'customer_insight', 'deal_data', 'email_triage',
      'competitive', 'research', 'field_note', 'system_log'
    )),
  department TEXT,
  source_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  confidence TEXT DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('critical', 'important', 'normal', 'low')),
  tags TEXT[] DEFAULT '{}',
  related_entity_type TEXT,
  related_entity_id UUID,
  cross_ref_ids UUID[] DEFAULT '{}',
  thread_id UUID,
  parent_entry_id UUID REFERENCES public.open_brain_entries(id) ON DELETE SET NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obe_embedding ON public.open_brain_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS idx_obe_source_agent ON public.open_brain_entries(source_agent_id);
CREATE INDEX IF NOT EXISTS idx_obe_category ON public.open_brain_entries(category);
CREATE INDEX IF NOT EXISTS idx_obe_department ON public.open_brain_entries(department);
CREATE INDEX IF NOT EXISTS idx_obe_created_at ON public.open_brain_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obe_priority ON public.open_brain_entries(priority);
CREATE INDEX IF NOT EXISTS idx_obe_source_type ON public.open_brain_entries(source_type);
CREATE INDEX IF NOT EXISTS idx_obe_thread_id ON public.open_brain_entries(thread_id);
CREATE INDEX IF NOT EXISTS idx_obe_entry_type ON public.open_brain_entries(entry_type);

-- ============================================================================
-- TABLE 4: email_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id TEXT UNIQUE,
  source_thread_id TEXT,
  sender_name TEXT,
  sender_email TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  raw_text TEXT,
  summary TEXT,
  category TEXT
    CHECK (category IN (
      'production', 'sales', 'finance', 'retail',
      'marketplace', 'regulatory', 'customer',
      'compliance', 'noise'
    )),
  secondary_categories TEXT[] DEFAULT '{}',
  classification_confidence NUMERIC(3,2),
  needs_human_review BOOLEAN DEFAULT FALSE,
  priority TEXT
    CHECK (priority IN ('critical', 'important', 'informational', 'noise')),
  action_required BOOLEAN DEFAULT FALSE,
  suggested_action TEXT,
  routed_agent_ids UUID[] DEFAULT '{}',
  status TEXT DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'actioned', 'archived')),
  open_brain_entry_ids UUID[] DEFAULT '{}',
  embedding VECTOR(1536),
  user_action TEXT,
  user_action_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ee_category ON public.email_events(category);
CREATE INDEX IF NOT EXISTS idx_ee_priority ON public.email_events(priority);
CREATE INDEX IF NOT EXISTS idx_ee_received_at ON public.email_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ee_action_required ON public.email_events(action_required);
CREATE INDEX IF NOT EXISTS idx_ee_status ON public.email_events(status);
CREATE INDEX IF NOT EXISTS idx_ee_embedding ON public.email_events
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- ============================================================================
-- TABLE 5: tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  assigned_to_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL
    CHECK (task_type IN (
      'research', 'analysis', 'outreach', 'report',
      'data_pull', 'classification', 'audit', 'notification'
    )),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'cancelled')),
  depends_on_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  input_ref TEXT,
  output_ref TEXT,
  deadline TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON public.tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON public.tasks(created_at DESC);

-- ============================================================================
-- TABLE 6: approvals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_agent_id UUID REFERENCES public.agents(id) NOT NULL,
  action_type TEXT NOT NULL
    CHECK (action_type IN (
      'send_email', 'update_listing', 'place_order',
      'contact_distributor', 'commit_funds', 'update_pricing',
      'schedule_production', 'other'
    )),
  target_entity_type TEXT,
  target_entity_id UUID,
  summary TEXT NOT NULL,
  supporting_data TEXT,
  proposed_payload JSONB DEFAULT '{}'::jsonb,
  resolved_payload JSONB DEFAULT '{}'::jsonb,
  confidence TEXT DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  risk_level TEXT DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  affected_departments TEXT[] DEFAULT '{}',
  permission_tier INTEGER NOT NULL DEFAULT 2
    CHECK (permission_tier BETWEEN 0 AND 3),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'modified', 'expired')),
  decided_by_user_id UUID REFERENCES public.users(id),
  decision TEXT
    CHECK (decision IN ('approved', 'denied', 'modified')),
  decision_reasoning TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  batch_group TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT approvals_state_consistency CHECK (
    (
      status = 'pending'
      AND decision IS NULL
      AND decided_by_user_id IS NULL
      AND decided_at IS NULL
    )
    OR
    (
      status IN ('approved', 'denied', 'modified')
      AND decision IS NOT NULL
      AND decided_by_user_id IS NOT NULL
      AND decided_at IS NOT NULL
    )
    OR
    (
      status = 'expired'
      AND decision IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON public.approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_tier ON public.approvals(permission_tier);
CREATE INDEX IF NOT EXISTS idx_approvals_agent ON public.approvals(requesting_agent_id);
CREATE INDEX IF NOT EXISTS idx_approvals_requested_at ON public.approvals(requested_at DESC);

-- ============================================================================
-- TABLE 7: decision_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID REFERENCES public.approvals(id) ON DELETE SET NULL,
  requesting_agent_id UUID REFERENCES public.agents(id) NOT NULL,
  action_proposed TEXT NOT NULL,
  action_pattern TEXT,
  supporting_data TEXT,
  confidence_level TEXT,
  cross_department_impact TEXT,
  risk_assessment TEXT,
  decision TEXT NOT NULL
    CHECK (decision IN ('approved', 'denied', 'modified')),
  reasoning TEXT,
  modification_notes TEXT,
  decided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  outcome TEXT,
  outcome_quality TEXT
    CHECK (outcome_quality IN ('positive', 'neutral', 'negative', 'unknown')),
  outcome_recorded_at TIMESTAMPTZ,
  pattern_match_score NUMERIC(3,2),
  matches_count INTEGER DEFAULT 0,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dl_pattern ON public.decision_log(action_pattern);
CREATE INDEX IF NOT EXISTS idx_dl_agent ON public.decision_log(requesting_agent_id);
CREATE INDEX IF NOT EXISTS idx_dl_decision ON public.decision_log(decision);
CREATE INDEX IF NOT EXISTS idx_dl_created_at ON public.decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dl_embedding ON public.decision_log
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- ============================================================================
-- TABLE 8: deals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name TEXT NOT NULL,
  account_type TEXT
    CHECK (account_type IN ('distributor', 'retailer', 'online', 'broker')),
  territory TEXT,
  stage TEXT DEFAULT 'prospect'
    CHECK (stage IN (
      'prospect', 'contacted', 'negotiating', 'terms_agreed',
      'contract', 'active', 'paused', 'lost'
    )),
  owner_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  units INTEGER,
  case_pack TEXT,
  wholesale_price NUMERIC(10,2),
  target_retail NUMERIC(10,2),
  margin_target NUMERIC(5,2),
  freight_model TEXT,
  payment_terms TEXT,
  promo_support TEXT,
  slotting TEXT,
  commission_structure TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  store_count INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deals_stage ON public.deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_account ON public.deals(account_name);
CREATE INDEX IF NOT EXISTS idx_deals_type ON public.deals(account_type);

-- Seed Inderbitzin deal
INSERT INTO public.deals (
  account_name, account_type, territory, stage,
  wholesale_price, target_retail, payment_terms,
  contact_name, notes
) VALUES (
  'Inderbitzin Distributors', 'distributor', 'PNW', 'negotiating',
  2.10, 4.99, 'TBD',
  'Brent Overman',
  'First distributor partner. Clip strip format. ~28.5% margin to Inderbitzin.'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- TABLE 9: deal_calculations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deal_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  input_text TEXT NOT NULL,
  parsed_inputs JSONB,
  cogs_snapshot JSONB,
  output_summary JSONB NOT NULL,
  benchmark_refs UUID[] DEFAULT '{}',
  risk_flags TEXT[] DEFAULT '{}',
  recommended_response TEXT
    CHECK (recommended_response IN ('accept', 'negotiate', 'walk')),
  recommendation_reasoning TEXT,
  counter_offer JSONB,
  talking_points TEXT[] DEFAULT '{}',
  requires_cfo_review BOOLEAN DEFAULT FALSE,
  review_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dc_deal ON public.deal_calculations(deal_id);
CREATE INDEX IF NOT EXISTS idx_dc_created_at ON public.deal_calculations(created_at DESC);

-- ============================================================================
-- TABLE 10: kpi_timeseries
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.kpi_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  metric_group TEXT
    CHECK (metric_group IN (
      'amazon', 'finance', 'inventory', 'sales', 'operations'
    )),
  source_system TEXT NOT NULL
    CHECK (source_system IN (
      'amazon', 'shopify', 'quickbooks', 'found',
      'faire', 'manual', 'calculated'
    )),
  department TEXT,
  entity_ref TEXT NOT NULL DEFAULT '',
  value NUMERIC(14,4) NOT NULL,
  window_type TEXT NOT NULL DEFAULT 'daily'
    CHECK (window_type IN ('daily', '7d_avg', '30d_avg', 'velocity')),
  captured_for_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_name, entity_ref, captured_for_date, window_type)
);

CREATE INDEX IF NOT EXISTS idx_kpi_metric_date ON public.kpi_timeseries(metric_name, captured_for_date DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_date ON public.kpi_timeseries(captured_for_date DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_source ON public.kpi_timeseries(source_system);
CREATE INDEX IF NOT EXISTS idx_kpi_window ON public.kpi_timeseries(window_type);
CREATE INDEX IF NOT EXISTS idx_kpi_group ON public.kpi_timeseries(metric_group);

-- ============================================================================
-- TABLE 11: product_config
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL,
  config_type TEXT DEFAULT 'text'
    CHECK (config_type IN ('text', 'number', 'json', 'boolean')),
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT DEFAULT 'manual'
);

-- Seed product config
INSERT INTO public.product_config (config_key, config_value, config_type, description) VALUES
  ('product_name', 'All American Gummy Bears', 'text', 'Primary product name'),
  ('bag_size_oz', '7.5', 'number', 'Bag size in ounces'),
  ('asin', 'B0G1JK92TJ', 'text', 'Amazon ASIN'),
  ('manufacturer', 'Albanese Confectionery', 'text', 'Product manufacturer'),
  ('packager', 'Dutch Valley Foods', 'text', 'Primary packager'),
  ('pnw_repacker', 'Powers Confections, Spokane WA', 'text', 'PNW regional repacker'),
  ('suggested_retail', '4.99', 'number', 'Suggested retail price'),
  ('positioning', 'Made in USA, dye-free gummy candy', 'text', 'Brand positioning statement'),
  ('strategic_window', '2026-07-04', 'text', 'Key strategic date'),
  ('regulatory_tailwind', 'FDA petroleum dye phase-out + 30+ state dye ban bills', 'text', 'Regulatory tailwind description'),
  ('competitive_gap', 'No competitor owns Made in USA + dye-free on Amazon', 'text', 'Competitive gap description'),
  ('proof_ashford', 'Ashford Valley Grocer: consistent weekly velocity at $4.99 with zero marketing after 66% price increase', 'text', 'Proof point — Ashford'),
  ('proof_amazon', '22-34% conversion rate on Amazon, industry-beating', 'text', 'Proof point — Amazon'),
  ('inderbitzin_status', 'Active negotiation — first distributor partner', 'text', 'Inderbitzin deal status'),
  ('inderbitzin_price', '2.10', 'number', 'Inderbitzin wholesale price'),
  ('inderbitzin_retail', '4.99', 'number', 'Inderbitzin target retail'),
  ('faire_active', 'true', 'boolean', 'Faire marketplace active'),
  ('funding_amount', '300000', 'number', 'Funding amount'),
  ('funding_structure', 'Revenue participation loan: 8% flat fee, 6-month deferral, 15% monthly revenue repayment', 'text', 'Funding structure'),
  -- Operational keys (bootstrap defaults — replace with real values)
  ('current_cogs_per_unit', '1.35', 'number', 'BOOTSTRAP DEFAULT — replace with real COGS per unit'),
  ('default_packaging_cost_per_unit', '0.15', 'number', 'BOOTSTRAP DEFAULT — replace with real packaging cost'),
  ('default_freight_cost_per_unit', '0.25', 'number', 'BOOTSTRAP DEFAULT — replace with real freight cost'),
  ('default_fixed_cost_basis', '5000.00', 'number', 'BOOTSTRAP DEFAULT — replace with real fixed cost basis'),
  ('default_target_margin_pct', '35.00', 'number', 'BOOTSTRAP DEFAULT — replace with real target margin %'),
  ('min_acceptable_margin_pct', '20.00', 'number', 'BOOTSTRAP DEFAULT — replace with min acceptable margin %'),
  ('max_net_terms_days', '30', 'number', 'BOOTSTRAP DEFAULT — replace with real max net terms days'),
  ('embedding_model', 'text-embedding-3-small', 'text', 'Locked embedding model for v1'),
  ('embedding_dimensions', '1536', 'number', 'Locked embedding dimensions for v1')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- TABLE 12: integration_health
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.integration_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name TEXT UNIQUE NOT NULL,
  connection_status TEXT DEFAULT 'not_configured'
    CHECK (connection_status IN ('connected', 'expired', 'error', 'not_configured')),
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  error_summary TEXT,
  owner_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed integrations
INSERT INTO public.integration_health (system_name) VALUES
  ('gmail'), ('notion'), ('amazon'), ('shopify'),
  ('quickbooks'), ('found'), ('faire'), ('slack'),
  ('supabase'), ('n8n')
ON CONFLICT (system_name) DO NOTHING;

-- ============================================================================
-- SUPPORTING UTILITIES
-- ============================================================================

-- A. updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables with updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users', 'agents', 'open_brain_entries', 'email_events',
      'tasks', 'approvals', 'deals', 'product_config',
      'integration_health'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I; '
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- B. search_memory function
CREATE OR REPLACE FUNCTION public.search_memory(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 10,
  filter_department TEXT DEFAULT NULL,
  filter_category TEXT DEFAULT NULL,
  filter_agent_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  raw_text TEXT,
  summary_text TEXT,
  category TEXT,
  department TEXT,
  source_type TEXT,
  confidence TEXT,
  tags TEXT[],
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    obe.id,
    obe.title,
    obe.raw_text,
    obe.summary_text,
    obe.category,
    obe.department,
    obe.source_type,
    obe.confidence,
    obe.tags,
    1 - (obe.embedding <=> query_embedding) AS similarity,
    obe.created_at
  FROM public.open_brain_entries obe
  WHERE obe.embedding IS NOT NULL
    AND (filter_department IS NULL OR obe.department = filter_department)
    AND (filter_category IS NULL OR obe.category = filter_category)
    AND (filter_agent_id IS NULL OR obe.source_agent_id = filter_agent_id)
  ORDER BY obe.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- C. search_decision_patterns function
CREATE OR REPLACE FUNCTION public.search_decision_patterns(
  pattern_filter TEXT DEFAULT NULL,
  min_count INT DEFAULT 10
)
RETURNS TABLE (
  action_pattern TEXT,
  total_decisions BIGINT,
  approval_rate NUMERIC,
  most_common_reasoning TEXT,
  last_decided_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.action_pattern,
    COUNT(*)::BIGINT AS total_decisions,
    ROUND(
      COUNT(*) FILTER (WHERE dl.decision = 'approved')::NUMERIC
      / GREATEST(COUNT(*), 1)::NUMERIC, 2
    ) AS approval_rate,
    (
      SELECT dl2.reasoning
      FROM public.decision_log dl2
      WHERE dl2.action_pattern = dl.action_pattern
        AND dl2.reasoning IS NOT NULL
      GROUP BY dl2.reasoning
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS most_common_reasoning,
    MAX(dl.created_at) AS last_decided_at
  FROM public.decision_log dl
  WHERE dl.action_pattern IS NOT NULL
    AND (pattern_filter IS NULL OR dl.action_pattern ILIKE '%' || pattern_filter || '%')
  GROUP BY dl.action_pattern
  HAVING COUNT(*) >= min_count
  ORDER BY COUNT(*) DESC;
END;
$$;

-- D. get_kpi_with_trend function
CREATE OR REPLACE FUNCTION public.get_kpi_with_trend(
  p_metric_name TEXT
)
RETURNS TABLE (
  metric_name TEXT,
  today_value NUMERIC,
  avg_7d NUMERIC,
  avg_30d NUMERIC,
  velocity NUMERIC,
  latest_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_metric_name AS metric_name,
    (SELECT k.value FROM public.kpi_timeseries k
     WHERE k.metric_name = p_metric_name AND k.window_type = 'daily'
     ORDER BY k.captured_for_date DESC LIMIT 1) AS today_value,
    (SELECT k.value FROM public.kpi_timeseries k
     WHERE k.metric_name = p_metric_name AND k.window_type = '7d_avg'
     ORDER BY k.captured_for_date DESC LIMIT 1) AS avg_7d,
    (SELECT k.value FROM public.kpi_timeseries k
     WHERE k.metric_name = p_metric_name AND k.window_type = '30d_avg'
     ORDER BY k.captured_for_date DESC LIMIT 1) AS avg_30d,
    (SELECT k.value FROM public.kpi_timeseries k
     WHERE k.metric_name = p_metric_name AND k.window_type = 'velocity'
     ORDER BY k.captured_for_date DESC LIMIT 1) AS velocity,
    (SELECT k.captured_for_date FROM public.kpi_timeseries k
     WHERE k.metric_name = p_metric_name
     ORDER BY k.captured_for_date DESC LIMIT 1) AS latest_date;
END;
$$;

-- E. Function access hardening
REVOKE EXECUTE ON FUNCTION public.search_memory FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_memory TO authenticated;

REVOKE EXECUTE ON FUNCTION public.search_decision_patterns FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_decision_patterns TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_kpi_with_trend FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kpi_with_trend TO authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_brain_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_timeseries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_health ENABLE ROW LEVEL SECURITY;

-- Helper: check if current auth user is founder
CREATE OR REPLACE FUNCTION public.is_founder()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid()
      AND role = 'founder'
      AND status = 'active'
  );
$$;

-- === users ===
CREATE POLICY users_founder_read ON public.users
  FOR SELECT USING (public.is_founder());
CREATE POLICY users_founder_update_own ON public.users
  FOR UPDATE USING (auth_user_id = auth.uid() AND public.is_founder());

-- === agents ===
CREATE POLICY agents_auth_read ON public.agents
  FOR SELECT TO authenticated USING (true);
-- No client writes on agents

-- === open_brain_entries ===
CREATE POLICY obe_founder_read ON public.open_brain_entries
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- === email_events ===
CREATE POLICY ee_founder_read ON public.email_events
  FOR SELECT USING (public.is_founder());
CREATE POLICY ee_founder_update ON public.email_events
  FOR UPDATE USING (public.is_founder())
  WITH CHECK (public.is_founder());
-- Inserts via service role only

-- === tasks ===
CREATE POLICY tasks_founder_read ON public.tasks
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- === approvals ===
CREATE POLICY approvals_founder_read ON public.approvals
  FOR SELECT USING (public.is_founder());
CREATE POLICY approvals_founder_decide ON public.approvals
  FOR UPDATE USING (public.is_founder())
  WITH CHECK (public.is_founder());
-- Only founder can approve/deny/modify via client; inserts from service role

-- === decision_log ===
CREATE POLICY dl_founder_read ON public.decision_log
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- === deals ===
CREATE POLICY deals_founder_read ON public.deals
  FOR SELECT USING (public.is_founder());
CREATE POLICY deals_founder_write ON public.deals
  FOR INSERT WITH CHECK (public.is_founder());
CREATE POLICY deals_founder_update ON public.deals
  FOR UPDATE USING (public.is_founder())
  WITH CHECK (public.is_founder());

-- === deal_calculations ===
CREATE POLICY dc_founder_read ON public.deal_calculations
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- === kpi_timeseries ===
CREATE POLICY kpi_founder_read ON public.kpi_timeseries
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- === product_config ===
CREATE POLICY pc_founder_read ON public.product_config
  FOR SELECT USING (public.is_founder());
CREATE POLICY pc_founder_write ON public.product_config
  FOR INSERT WITH CHECK (public.is_founder());
CREATE POLICY pc_founder_update ON public.product_config
  FOR UPDATE USING (public.is_founder())
  WITH CHECK (public.is_founder());

-- === integration_health ===
CREATE POLICY ih_founder_read ON public.integration_health
  FOR SELECT USING (public.is_founder());
-- Writes via service role only

-- ============================================================================
-- REALTIME
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.open_brain_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kpi_timeseries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_health;

-- ============================================================================
-- SEED TEST DATA for semantic search verification
-- ============================================================================
INSERT INTO public.open_brain_entries (
  source_type, entry_type, title, raw_text, summary_text,
  category, department, confidence, priority, tags
) VALUES (
  'manual', 'finding',
  'Abra OS Bootstrap Test Entry',
  'This is a test entry to verify that the open_brain_entries table and semantic search pipeline are working correctly. The Abra OS foundation has been deployed.',
  'Bootstrap test entry for semantic search verification.',
  'system_log', 'systems', 'high', 'normal',
  ARRAY['bootstrap', 'test', 'verification']
) ON CONFLICT DO NOTHING;

COMMIT;
