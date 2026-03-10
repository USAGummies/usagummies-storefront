-- Migration: Expand open_brain_entries.category to include 'teaching' and 'general'
-- The teach endpoint uses entry_type='teaching' with category='teaching',
-- but the original CHECK constraint only allowed specific business categories.
-- Adding 'teaching' and 'general' to support the education/teach workflow.

ALTER TABLE open_brain_entries DROP CONSTRAINT IF EXISTS open_brain_entries_category_check;
ALTER TABLE open_brain_entries ADD CONSTRAINT open_brain_entries_category_check
  CHECK (category IN (
    -- Original categories
    'market_intel', 'financial', 'operational', 'regulatory',
    'customer_insight', 'deal_data', 'email_triage',
    'competitive', 'research', 'field_note', 'system_log',
    -- New categories for teaching & education system
    'teaching', 'general', 'company_info', 'product_info',
    'supply_chain', 'sales', 'founder', 'culture'
  ));
