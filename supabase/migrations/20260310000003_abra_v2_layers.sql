-- Abra v2 Intelligence Layers
-- Adds: fact lifecycle, team/vendor directory, initiative dependencies,
-- answer logging (truth benchmarking), knowledge feeds, operational signals,
-- DB-backed playbooks, session scratchpad, tiered memory search.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Fact Lifecycle — superseded entries tracking
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'open_brain_entries' AND column_name = 'superseded_by'
  ) THEN
    ALTER TABLE public.open_brain_entries ADD COLUMN superseded_by UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'open_brain_entries' AND column_name = 'superseded_at'
  ) THEN
    ALTER TABLE public.open_brain_entries ADD COLUMN superseded_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brain_superseded ON public.open_brain_entries(superseded_by)
  WHERE superseded_by IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════
-- 2. Dynamic Team Directory
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT,
  email TEXT,
  responsibilities TEXT[],
  reports_to TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  key_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_active ON public.abra_team(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_team_department ON public.abra_team(department);

ALTER TABLE public.abra_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_team" ON public.abra_team
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_team_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_updated_at ON public.abra_team;
CREATE TRIGGER trg_team_updated_at
  BEFORE UPDATE ON public.abra_team
  FOR EACH ROW EXECUTE FUNCTION public.set_team_updated_at();

-- Seed initial team
INSERT INTO public.abra_team (name, role, department, responsibilities, email, key_context) VALUES
  ('Ben Stutman', 'CEO & Founder', 'executive', ARRAY['Strategic decisions', 'Sales & growth leadership', 'Investor relations'], 'ben@usagummies.com', 'Makes all final decisions. Leads B2B sales and DTC growth.'),
  ('Andrew Slater', 'Operations Manager', 'operations', ARRAY['Production runs', 'Supply chain', 'Vendor relationships'], NULL, 'Manages Powers Confections (co-packer) in Spokane, WA. Oversees inventory and fulfillment.'),
  ('Rene Gonzalez', 'Finance Lead', 'finance', ARRAY['Accounting', 'Bookkeeping', 'Cash flow', 'Financial reporting'], NULL, 'Handles QuickBooks, AP/AR, monthly close, tax compliance.')
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
-- 3. Vendor Directory
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vendor_type TEXT DEFAULT 'vendor',
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  location TEXT,
  products_services TEXT[],
  notes TEXT,
  department TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  relationship_status TEXT NOT NULL DEFAULT 'active'
    CHECK (relationship_status IN ('active','inactive','prospect','on_hold')),
  payment_terms TEXT,
  lead_time_days INTEGER,
  key_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_active ON public.abra_vendors(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vendors_department ON public.abra_vendors(department);

ALTER TABLE public.abra_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_vendors" ON public.abra_vendors
  FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_vendors_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.abra_vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.abra_vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_vendors_updated_at();

-- Seed known vendor
INSERT INTO public.abra_vendors (name, vendor_type, products_services, location, department, relationship_status, key_context) VALUES
  ('Powers Confections', 'co-packer', ARRAY['Co-packing', 'Gummy manufacturing'], 'Spokane, WA', 'operations', 'active', 'Primary co-packer. Handles all production runs.')
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
-- 4. Cross-Department Initiative Dependencies
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_initiative_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL REFERENCES public.abra_initiatives(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES public.abra_initiatives(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'blocks'
    CHECK (relationship_type IN ('blocks','informs','requires','enables')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_dependency CHECK (initiative_id != depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_init_deps_initiative ON public.abra_initiative_dependencies(initiative_id);
CREATE INDEX IF NOT EXISTS idx_init_deps_depends_on ON public.abra_initiative_dependencies(depends_on_id);

ALTER TABLE public.abra_initiative_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_init_deps" ON public.abra_initiative_dependencies
  FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════
-- 5. Answer Log — Truth Benchmarking
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_answer_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources_used JSONB DEFAULT '[]'::jsonb,
  source_ids TEXT[],
  source_tables TEXT[],
  memory_tiers_used TEXT[],
  confidence NUMERIC(4,3),
  department TEXT,
  asked_by TEXT,
  channel TEXT,
  model_used TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  was_corrected BOOLEAN DEFAULT false,
  correction_id UUID,
  correction_delay_hours NUMERIC(10,2),
  user_feedback TEXT CHECK (user_feedback IN ('positive','negative')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_log_created ON public.abra_answer_log(created_at);
CREATE INDEX IF NOT EXISTS idx_answer_log_department ON public.abra_answer_log(department);
CREATE INDEX IF NOT EXISTS idx_answer_log_corrected ON public.abra_answer_log(was_corrected) WHERE was_corrected = true;


ALTER TABLE public.abra_answer_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_answer_log" ON public.abra_answer_log
  FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════
-- 6. Knowledge Feeds — Auto-Teach Configuration
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_knowledge_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('shopify_orders','shopify_products','amazon_orders','faire_orders','supabase_kpis','custom')),
  department TEXT,
  endpoint_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  schedule TEXT DEFAULT 'daily',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abra_knowledge_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_knowledge_feeds" ON public.abra_knowledge_feeds
  FOR ALL USING (true) WITH CHECK (true);

-- Seed default feeds
INSERT INTO public.abra_knowledge_feeds (feed_key, name, source_type, department, endpoint_config) VALUES
  ('shopify_orders', 'Shopify Order Summary', 'shopify_orders', 'sales_and_growth', '{"summary_type": "daily_totals", "include_line_items": false}'),
  ('shopify_products', 'Shopify Product Catalog', 'shopify_products', 'operations', '{"sync_inventory": true, "sync_pricing": true}'),
  ('amazon_orders', 'Amazon Order Summary', 'amazon_orders', 'sales_and_growth', '{"summary_type": "daily_totals"}'),
  ('faire_orders', 'Faire Order Summary', 'faire_orders', 'sales_and_growth', '{"summary_type": "daily_totals"}'),
  ('supabase_kpis', 'KPI Snapshot', 'supabase_kpis', 'executive', '{"tables": ["abra_cost_log", "abra_answer_log"]}')
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
-- 7. Operational Signals — extracted from email & system events
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_operational_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  department TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  severity TEXT DEFAULT 'info'
    CHECK (severity IN ('info','warning','critical')),
  metadata JSONB DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','acknowledged','acted_on','dismissed','expired')),
  priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('critical','high','normal','low')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_acknowledged ON public.abra_operational_signals(acknowledged) WHERE acknowledged = false;
CREATE INDEX IF NOT EXISTS idx_signals_severity ON public.abra_operational_signals(severity);
CREATE INDEX IF NOT EXISTS idx_signals_department ON public.abra_operational_signals(department);
CREATE INDEX IF NOT EXISTS idx_signals_created ON public.abra_operational_signals(created_at);

ALTER TABLE public.abra_operational_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_signals" ON public.abra_operational_signals
  FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════
-- 8. DB-Backed Playbooks
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.abra_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  baseline JSONB DEFAULT '[]'::jsonb,
  questions JSONB DEFAULT '[]'::jsonb,
  task_template JSONB DEFAULT '[]'::jsonb,
  kpis JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'hardcoded'
    CHECK (source IN ('hardcoded','learned','proposed','approved')),
  proposed_by TEXT,
  approved_by TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_department ON public.abra_playbooks(department);
CREATE INDEX IF NOT EXISTS idx_playbooks_active ON public.abra_playbooks(active) WHERE active = true;

ALTER TABLE public.abra_playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_playbooks" ON public.abra_playbooks
  FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════
-- 9. Session Scratchpad (multi-turn reasoning)
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_sessions' AND column_name = 'scratchpad'
  ) THEN
    ALTER TABLE public.abra_sessions ADD COLUMN scratchpad JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 10. Tiered Memory Search RPC
-- ═══════════════════════════════════════════════════════════════════

-- First, modify search_temporal to exclude superseded entries
CREATE OR REPLACE FUNCTION public.search_temporal(
  query_embedding vector(1536),
  match_count integer DEFAULT 8,
  filter_tables text[] DEFAULT ARRAY['brain', 'email']
)
RETURNS TABLE (
  id uuid,
  source_table text,
  title text,
  raw_text text,
  summary_text text,
  category text,
  department text,
  similarity double precision,
  temporal_score double precision,
  days_ago double precision,
  created_at timestamptz,
  updated_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH brain_results AS (
    SELECT
      b.id,
      'brain'::text AS source_table,
      b.title,
      b.raw_text,
      b.summary_text,
      b.category,
      b.department,
      1 - (b.embedding <=> query_embedding) AS similarity,
      EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 AS days_ago_val,
      b.created_at,
      COALESCE(b.updated_at, b.created_at) AS updated_at,
      jsonb_build_object(
        'entry_type', b.entry_type,
        'priority', b.priority,
        'confidence', b.confidence,
        'source_type', b.source_type
      ) AS metadata
    FROM public.open_brain_entries b
    WHERE b.embedding IS NOT NULL
      AND 'brain' = ANY(filter_tables)
      AND b.superseded_by IS NULL  -- EXCLUDE superseded entries
  ),
  email_results AS (
    SELECT
      e.id,
      'email'::text AS source_table,
      e.subject AS title,
      e.body_text AS raw_text,
      e.summary AS summary_text,
      e.classification AS category,
      NULL::text AS department,
      1 - (e.embedding <=> query_embedding) AS similarity,
      EXTRACT(EPOCH FROM (now() - COALESCE(e.received_at, e.created_at))) / 86400.0 AS days_ago_val,
      COALESCE(e.received_at, e.created_at) AS created_at,
      COALESCE(e.received_at, e.created_at) AS updated_at,
      jsonb_build_object(
        'from_email', e.from_email,
        'to_email', e.to_email,
        'classification', e.classification
      ) AS metadata
    FROM public.abra_emails e
    WHERE e.embedding IS NOT NULL
      AND 'email' = ANY(filter_tables)
  ),
  combined AS (
    SELECT * FROM brain_results
    UNION ALL
    SELECT * FROM email_results
  )
  SELECT
    c.id,
    c.source_table,
    c.title,
    c.raw_text,
    c.summary_text,
    c.category,
    c.department,
    c.similarity,
    -- Temporal decay: boost recent, penalize old
    c.similarity * (1.0 / (1.0 + c.days_ago_val / 30.0)) AS temporal_score,
    c.days_ago_val AS days_ago,
    c.created_at,
    c.updated_at,
    c.metadata
  FROM combined c
  WHERE c.similarity > 0.15
  ORDER BY (c.similarity * (1.0 / (1.0 + c.days_ago_val / 30.0))) DESC
  LIMIT match_count;
END;
$$;


-- Tiered search: returns hot, warm, cold tiers separately
CREATE OR REPLACE FUNCTION public.search_temporal_tiered(
  query_embedding vector(1536),
  hot_count integer DEFAULT 5,
  warm_count integer DEFAULT 5,
  cold_count integer DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  source_table text,
  title text,
  raw_text text,
  summary_text text,
  category text,
  department text,
  similarity double precision,
  temporal_score double precision,
  days_ago double precision,
  memory_tier text,
  created_at timestamptz,
  updated_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY

  -- HOT tier: corrections + recent KPIs (always highest priority)
  (
    SELECT
      b.id, 'brain'::text, b.title, b.raw_text, b.summary_text,
      b.category, b.department,
      1 - (b.embedding <=> query_embedding) AS similarity,
      (1 - (b.embedding <=> query_embedding)) * 2.0 AS temporal_score,
      EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 AS days_ago,
      'hot'::text AS memory_tier,
      b.created_at, COALESCE(b.updated_at, b.created_at),
      jsonb_build_object('entry_type', b.entry_type, 'priority', b.priority, 'confidence', b.confidence)
    FROM public.open_brain_entries b
    WHERE b.embedding IS NOT NULL
      AND b.superseded_by IS NULL
      AND b.entry_type IN ('correction', 'kpi')
      AND (1 - (b.embedding <=> query_embedding)) > 0.1
    ORDER BY (1 - (b.embedding <=> query_embedding)) DESC
    LIMIT hot_count
  )

  UNION ALL

  -- WARM tier: recent teachings + sessions (< 30 days, high boost)
  (
    SELECT
      b.id, 'brain'::text, b.title, b.raw_text, b.summary_text,
      b.category, b.department,
      1 - (b.embedding <=> query_embedding) AS similarity,
      (1 - (b.embedding <=> query_embedding)) * 1.5 AS temporal_score,
      EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 AS days_ago,
      'warm'::text AS memory_tier,
      b.created_at, COALESCE(b.updated_at, b.created_at),
      jsonb_build_object('entry_type', b.entry_type, 'priority', b.priority, 'confidence', b.confidence)
    FROM public.open_brain_entries b
    WHERE b.embedding IS NOT NULL
      AND b.superseded_by IS NULL
      AND b.entry_type IN ('teaching', 'session_summary', 'auto_teach')
      AND COALESCE(b.updated_at, b.created_at) > now() - INTERVAL '30 days'
      AND (1 - (b.embedding <=> query_embedding)) > 0.15
    ORDER BY (1 - (b.embedding <=> query_embedding)) * 1.5 DESC
    LIMIT warm_count
  )

  UNION ALL

  -- COLD tier: historical data (searched only when relevant)
  (
    SELECT
      sub.id, sub.source_table, sub.title, sub.raw_text, sub.summary_text,
      sub.category, sub.department, sub.similarity, sub.temporal_score,
      sub.days_ago, 'cold'::text AS memory_tier,
      sub.created_at, sub.updated_at, sub.metadata
    FROM (
      SELECT
        b.id, 'brain'::text AS source_table, b.title, b.raw_text, b.summary_text,
        b.category, b.department,
        1 - (b.embedding <=> query_embedding) AS similarity,
        (1 - (b.embedding <=> query_embedding)) * (1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 / 30.0)) AS temporal_score,
        EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 AS days_ago,
        b.created_at, COALESCE(b.updated_at, b.created_at) AS updated_at,
        jsonb_build_object('entry_type', b.entry_type, 'priority', b.priority, 'confidence', b.confidence) AS metadata
      FROM public.open_brain_entries b
      WHERE b.embedding IS NOT NULL
        AND b.superseded_by IS NULL
        AND b.entry_type NOT IN ('correction', 'kpi')
        AND (1 - (b.embedding <=> query_embedding)) > 0.2

      UNION ALL

      SELECT
        e.id, 'email'::text, e.subject, e.body_text, e.summary,
        e.classification, NULL::text,
        1 - (e.embedding <=> query_embedding),
        (1 - (e.embedding <=> query_embedding)) * (1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - COALESCE(e.received_at, e.created_at))) / 86400.0 / 30.0)),
        EXTRACT(EPOCH FROM (now() - COALESCE(e.received_at, e.created_at))) / 86400.0,
        COALESCE(e.received_at, e.created_at), COALESCE(e.received_at, e.created_at),
        jsonb_build_object('from_email', e.from_email, 'classification', e.classification)
      FROM public.abra_emails e
      WHERE e.embedding IS NOT NULL
        AND (1 - (e.embedding <=> query_embedding)) > 0.2
    ) sub
    ORDER BY sub.temporal_score DESC
    LIMIT cold_count
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 11. Accuracy Report RPC
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_accuracy_report(
  report_days integer DEFAULT 30
)
RETURNS TABLE(
  total_answers BIGINT,
  corrected_answers BIGINT,
  accuracy_pct NUMERIC,
  avg_correction_delay_hours NUMERIC,
  by_department JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_answers,
    COUNT(*) FILTER (WHERE a.corrected_later = true)::BIGINT AS corrected_answers,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((1.0 - COUNT(*) FILTER (WHERE a.corrected_later = true)::NUMERIC / COUNT(*)::NUMERIC) * 100, 1)
      ELSE 100.0
    END AS accuracy_pct,
    ROUND(AVG(a.correction_delay_hours) FILTER (WHERE a.corrected_later = true), 1) AS avg_correction_delay_hours,
    COALESCE(
      jsonb_object_agg(
        sub.dept,
        jsonb_build_object(
          'total', sub.total,
          'corrected', sub.corrected,
          'accuracy_pct', sub.acc
        )
      ) FILTER (WHERE sub.dept IS NOT NULL),
      '{}'::jsonb
    ) AS by_department
  FROM public.abra_answer_log a
  LEFT JOIN LATERAL (
    SELECT
      a2.department AS dept,
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE a2.corrected_later = true)::INTEGER AS corrected,
      CASE WHEN COUNT(*) > 0 THEN
        ROUND((1.0 - COUNT(*) FILTER (WHERE a2.corrected_later = true)::NUMERIC / COUNT(*)::NUMERIC) * 100, 1)
      ELSE 100.0 END AS acc
    FROM public.abra_answer_log a2
    WHERE a2.created_at > now() - (report_days || ' days')::INTERVAL
      AND a2.department IS NOT NULL
    GROUP BY a2.department
  ) sub ON true
  WHERE a.created_at > now() - (report_days || ' days')::INTERVAL;
END;
$$;
