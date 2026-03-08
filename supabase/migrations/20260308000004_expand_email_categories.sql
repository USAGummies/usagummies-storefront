-- Migration: Expand email_events.category CHECK for W02 classifier compatibility
-- W02 classifies emails into categories beyond the original Prompt 1 set.

ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_category_check;
ALTER TABLE email_events ADD CONSTRAINT email_events_category_check
  CHECK (category IS NULL OR category IN (
    -- Original Prompt 1 categories
    'production', 'sales', 'finance', 'retail',
    'marketplace', 'regulatory', 'customer',
    'compliance', 'noise',
    -- W02 classifier categories
    'order_inquiry', 'wholesale', 'support', 'return_refund',
    'b2b_outreach', 'partnership', 'marketing', 'shipping',
    'inventory', 'legal', 'spam', 'other'
  ));

NOTIFY pgrst, 'reload schema';
