-- Fix: Drop classification_confidence CHECK and widen NUMERIC type
-- NUMERIC(3,2) is too restrictive; W02 classifier uses 0-1 float scale.

-- Drop the auto-named constraint if it exists
ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_classification_confidence_check;

-- Widen from NUMERIC(3,2) to unconstrained NUMERIC using explicit cast
ALTER TABLE email_events
  ALTER COLUMN classification_confidence TYPE NUMERIC
  USING classification_confidence::numeric;

NOTIFY pgrst, 'reload schema';
