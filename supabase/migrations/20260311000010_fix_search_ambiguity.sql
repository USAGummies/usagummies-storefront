-- Migration: Fix search_temporal PGRST203 ambiguity + create abra_emails stub
--
-- Problem: Two versions of search_temporal existed with overlapping signatures:
--   V1 (3 params): (vector, integer DEFAULT 8, text[])
--   V2 (5 params): (vector, integer DEFAULT 10, text[], text DEFAULT NULL, text DEFAULT NULL)
-- PostgREST couldn't disambiguate between them (PGRST203 error).
-- Solution: Drop V1 since V2 is a superset.
--
-- Also creates abra_emails stub table so search_temporal_tiered's COLD tier
-- query doesn't fail with 42P01 (relation not found).

-- Drop the 3-param version (V1) — V2 handles all the same cases plus dept/category filtering
DROP FUNCTION IF EXISTS public.search_temporal(vector, integer, text[]);

-- Create stub abra_emails table (will be populated by email pipeline later)
CREATE TABLE IF NOT EXISTS public.abra_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email TEXT,
  to_emails TEXT[],
  subject TEXT,
  body_text TEXT,
  summary TEXT,
  classification TEXT,
  embedding vector(1536),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fix search_temporal_tiered type cast issue (42804: numeric vs double precision)
-- All computed columns must be explicitly cast to double precision to match RETURN TABLE
CREATE OR REPLACE FUNCTION public.search_temporal_tiered(
  query_embedding vector,
  hot_count integer DEFAULT 5,
  warm_count integer DEFAULT 5,
  cold_count integer DEFAULT 3
)
RETURNS TABLE(
  id uuid, source_table text, title text, raw_text text, summary_text text,
  category text, department text, similarity double precision,
  temporal_score double precision, days_ago double precision,
  memory_tier text, created_at timestamptz, updated_at timestamptz, metadata jsonb
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY

  -- HOT tier: corrections + recent KPIs (always highest priority, 2x boost)
  (
    SELECT
      b.id, 'brain'::text, b.title, b.raw_text, b.summary_text,
      b.category, b.department,
      (1 - (b.embedding <=> query_embedding))::double precision AS similarity,
      ((1 - (b.embedding <=> query_embedding)) * 2.0)::double precision AS temporal_score,
      (EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0)::double precision AS days_ago,
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

  -- WARM tier: recent teachings + sessions (< 30 days, 1.5x boost)
  (
    SELECT
      b.id, 'brain'::text, b.title, b.raw_text, b.summary_text,
      b.category, b.department,
      (1 - (b.embedding <=> query_embedding))::double precision AS similarity,
      ((1 - (b.embedding <=> query_embedding)) * 1.5)::double precision AS temporal_score,
      (EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0)::double precision AS days_ago,
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

  -- COLD tier: all historical data with temporal decay
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
        (1 - (b.embedding <=> query_embedding))::double precision AS similarity,
        ((1 - (b.embedding <=> query_embedding))::double precision *
         (1.0::double precision / (1.0::double precision +
          (EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0 / 30.0)::double precision
         ))) AS temporal_score,
        (EXTRACT(EPOCH FROM (now() - COALESCE(b.updated_at, b.created_at))) / 86400.0)::double precision AS days_ago,
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
        (1 - (e.embedding <=> query_embedding))::double precision,
        ((1 - (e.embedding <=> query_embedding))::double precision *
         (1.0::double precision / (1.0::double precision +
          (EXTRACT(EPOCH FROM (now() - COALESCE(e.received_at, e.created_at))) / 86400.0 / 30.0)::double precision
         ))),
        (EXTRACT(EPOCH FROM (now() - COALESCE(e.received_at, e.created_at))) / 86400.0)::double precision,
        COALESCE(e.received_at, e.created_at),
        COALESCE(e.received_at, e.created_at),
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
