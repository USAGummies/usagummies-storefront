-- Migration: Proactive Operations — Email Drafting + Financial Processing
-- Adds draft_status to email_events and financial_processed to open_brain_entries

-- ============================================================
-- 1. email_events.draft_status — tracks emails through drafting pipeline
-- ============================================================
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS draft_status TEXT;
ALTER TABLE email_events ADD CONSTRAINT email_events_draft_status_check
  CHECK (draft_status IS NULL OR draft_status IN (
    'pending_draft', 'draft_ready', 'approved', 'sent', 'skipped'
  ));
CREATE INDEX IF NOT EXISTS idx_email_events_draft_status
  ON email_events (draft_status) WHERE draft_status IS NOT NULL;

-- ============================================================
-- 2. open_brain_entries.financial_processed — prevents re-processing
-- ============================================================
ALTER TABLE open_brain_entries ADD COLUMN IF NOT EXISTS financial_processed BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_brain_financial_unprocessed
  ON open_brain_entries (department, financial_processed)
  WHERE department = 'finance' AND (financial_processed IS NULL OR financial_processed = FALSE);

-- ============================================================
-- 3. Reload schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
