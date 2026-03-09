-- ============================================================================
-- Abra OS — Notion Sync Indexes
-- Created: 2026-03-09
-- Description: Index on source_ref for dedup queries during Notion→Supabase sync
-- ============================================================================

-- Index for efficient Notion sync dedup queries on source_ref
CREATE INDEX IF NOT EXISTS idx_obe_source_ref ON public.open_brain_entries(source_ref)
  WHERE source_ref IS NOT NULL;
