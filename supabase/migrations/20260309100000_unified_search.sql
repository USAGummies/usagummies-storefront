-- ============================================================================
-- Abra OS — Unified Semantic Search RPC
-- Created: 2026-03-09
-- Description: search across open_brain_entries + email_events
-- ============================================================================

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
      1 - (obe.embedding <=> query_embedding) AS similarity,
      obe.created_at,
      jsonb_build_object(
        'source_type', obe.source_type,
        'source_ref', obe.source_ref,
        'confidence', obe.confidence,
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
      1 - (ee.embedding <=> query_embedding) AS similarity,
      COALESCE(ee.received_at, ee.created_at) AS created_at,
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
  )
  SELECT *
  FROM (
    SELECT * FROM brain
    UNION ALL
    SELECT * FROM email
  ) unified
  ORDER BY similarity DESC, created_at DESC
  LIMIT GREATEST(match_count, 1);
$$;

REVOKE EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_unified(VECTOR, INT, TEXT[], TEXT, TEXT) TO service_role;

