-- Migration: Fix CHECK constraints on open_brain_entries
--
-- 1. Add 'correction' to category constraint (correct_claim action uses it)
-- 2. Add 'kpi', 'session_summary', 'auto_teach' to entry_type constraint
--    (search_temporal_tiered references these but they were never added)

-- Fix category constraint
ALTER TABLE open_brain_entries DROP CONSTRAINT IF EXISTS open_brain_entries_category_check;
ALTER TABLE open_brain_entries ADD CONSTRAINT open_brain_entries_category_check
  CHECK (category IN (
    'market_intel', 'financial', 'operational', 'regulatory',
    'customer_insight', 'deal_data', 'email_triage',
    'competitive', 'research', 'field_note', 'system_log',
    'teaching', 'general', 'company_info', 'product_info',
    'supply_chain', 'sales', 'founder', 'culture',
    'correction'
  ));

-- Fix entry_type constraint
ALTER TABLE open_brain_entries DROP CONSTRAINT IF EXISTS open_brain_entries_entry_type_check;
ALTER TABLE open_brain_entries ADD CONSTRAINT open_brain_entries_entry_type_check
  CHECK (entry_type IN (
    'finding', 'research', 'field_note', 'summary',
    'alert', 'system_log', 'correction', 'teaching',
    'kpi', 'session_summary', 'auto_teach'
  ));
