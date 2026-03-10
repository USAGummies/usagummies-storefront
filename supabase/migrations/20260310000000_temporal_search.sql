-- ============================================================================
-- Abra OS — Temporal-Weighted Semantic Search
-- Created: 2026-03-10
-- Description: search_temporal ranks by blended similarity * recency score
-- Formula: final_score = similarity * (0.5 + 0.5 * temporal_boost)
-- This ensures recent relevant content always beats old relevant content
-- while maintaining a floor of 50% pure similarity to prevent irrelevant
-- recent content from dominating.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_temporal(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 10,
  filter_tables TEXT[] DEFAULT ARRAY['brain', 'email']::TEXT[],
  filter_department TEXT DEFAULT NULL,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_table TEXT,
  title TEXT,
  raw_text TEXT,
  summary_text TEXT,
  category TEXT,
  department TEXT,
  similarity FLOAT,
  temporal_score FLOAT,
  days_ago INT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH selected AS (
    SELECT COALESCE(filter_tables, ARRAY['brain', 'email']::TEXT[]) AS tables
  ),
  brain AS (
    SELECT
      obe.id,
      'brain'::TEXT AS source_table,
      COALESCE(NULLIF(obe.title, ''), '(untitled)') AS title,
      obe.raw_text,
      obe.summary_text,
      obe.category,
      obe.department,
      (1 - (obe.embedding <=> query_embedding))::FLOAT AS similarity,
      GREATEST(obe.updated_at, obe.created_at) AS effective_date,
      obe.created_at,
      obe.updated_at,
      jsonb_build_object(
        'source_type', obe.source_type,
        'source_ref', obe.source_ref,
        'entry_type', obe.entry_type,
        'confidence', obe.confidence,
        'priority', obe.priority,
        'tags', obe.tags
      ) AS metadata
    FROM public.open_brain_entries obe, selected s
    WHERE obe.embedding IS NOT NULL
      AND 'brain' = ANY (s.tables)
      AND (filter_department IS NULL OR obe.department = filter_department)
      AND (filter_category IS NULL OR obe.category = filter_category)
  ),
  email AS (
    SELECT
      ee.id,
      'email'::TEXT AS source_table,
      COALESCE(NULLIF(ee.subject, ''), '(no subject)') AS title,
      ee.raw_text,
      ee.summary AS summary_text,
      ee.category,
      NULL::TEXT AS department,
      (1 - (ee.embedding <=> query_embedding))::FLOAT AS similarity,
      GREATEST(COALESCE(ee.received_at, ee.created_at), ee.updated_at) AS effective_date,
      COALESCE(ee.received_at, ee.created_at) AS created_at,
      ee.updated_at,
      jsonb_build_object(
        'sender_name', ee.sender_name,
        'sender_email', ee.sender_email,
        'priority', ee.priority,
        'action_required', ee.action_required,
        'status', ee.status,
        'source_thread_id', ee.source_thread_id,
        'provider_message_id', ee.provider_message_id
      ) AS metadata
    FROM public.email_events ee, selected s
    WHERE ee.embedding IS NOT NULL
      AND 'email' = ANY (s.tables)
      AND (filter_category IS NULL OR ee.category = filter_category)
      AND filter_department IS NULL
  ),
  unified AS (
    SELECT * FROM brain
    UNION ALL
    SELECT * FROM email
  ),
  scored AS (
    SELECT
      u.id,
      u.source_table,
      u.title,
      u.raw_text,
      u.summary_text,
      u.category,
      u.department,
      u.similarity,
      -- Temporal boost: recent data gets higher multiplier
      -- 0-7 days: 1.0, 7-30 days: 0.9, 30-90 days: 0.7, 90-365 days: 0.4, 1yr+: 0.15
      u.similarity * (0.5 + 0.5 * (
        CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - u.effective_date)) / 86400.0 <= 7 THEN 1.0
          WHEN EXTRACT(EPOCH FROM (NOW() - u.effective_date)) / 86400.0 <= 30 THEN 0.9
          WHEN EXTRACT(EPOCH FROM (NOW() - u.effective_date)) / 86400.0 <= 90 THEN 0.7
          WHEN EXTRACT(EPOCH FROM (NOW() - u.effective_date)) / 86400.0 <= 365 THEN 0.4
          ELSE 0.15
        END
      ))::FLOAT AS temporal_score,
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - u.effective_date)) / 86400.0)::INT AS days_ago,
      u.created_at,
      u.updated_at,
      u.metadata
    FROM unified u
  )
  SELECT
    s.id,
    s.source_table,
    s.title,
    s.raw_text,
    s.summary_text,
    s.category,
    s.department,
    s.similarity,
    s.temporal_score,
    s.days_ago,
    s.created_at,
    s.updated_at,
    s.metadata
  FROM scored s
  ORDER BY s.temporal_score DESC, s.created_at DESC
  LIMIT GREATEST(match_count, 1);
$$;

-- Grant access
REVOKE EXECUTE ON FUNCTION public.search_temporal(VECTOR, INT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_temporal(VECTOR, INT, TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_temporal(VECTOR, INT, TEXT[], TEXT, TEXT) TO service_role;

-- Keep search_unified as backward-compatible wrapper
-- (existing callers won't break, but results are now temporal-weighted too)
CREATE OR REPLACE FUNCTION public.search_unified(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 10,
  filter_tables TEXT[] DEFAULT ARRAY['brain', 'email']::TEXT[],
  filter_department TEXT DEFAULT NULL,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_table TEXT,
  title TEXT,
  raw_text TEXT,
  summary_text TEXT,
  category TEXT,
  department TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    st.id,
    st.source_table,
    st.title,
    st.raw_text,
    st.summary_text,
    st.category,
    st.department,
    st.similarity,
    st.created_at,
    st.metadata
  FROM public.search_temporal(
    query_embedding, match_count, filter_tables, filter_department, filter_category
  ) st;
$$;

REVOKE EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) TO service_role;
