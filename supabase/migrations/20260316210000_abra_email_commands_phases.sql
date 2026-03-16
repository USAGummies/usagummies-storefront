-- Add multi-phase workflow columns to abra_email_commands
-- Phases: pending_approval → approved → executing → draft_reply_pending → reply_approved → completed
--         (or: denied / execution_failed at any point)

ALTER TABLE public.abra_email_commands
  DROP CONSTRAINT IF EXISTS abra_email_commands_status_check;

ALTER TABLE public.abra_email_commands
  ADD CONSTRAINT abra_email_commands_status_check
    CHECK (status IN (
      'pending_approval',    -- waiting for Ben to approve task execution
      'approved',            -- Ben approved, about to execute
      'executing',           -- LLM is working on the task
      'executed',            -- task done, no reply needed (legacy compat)
      'draft_reply_pending', -- task done, draft reply waiting for Ben's approval
      'reply_approved',      -- Ben approved the reply, sending now
      'completed',           -- task done + reply sent (full workflow complete)
      'denied',              -- Ben denied the task
      'execution_failed'     -- something broke
    ));

-- Store the draft reply email for Ben to review before sending
ALTER TABLE public.abra_email_commands
  ADD COLUMN IF NOT EXISTS draft_reply_subject TEXT,
  ADD COLUMN IF NOT EXISTS draft_reply_body TEXT,
  ADD COLUMN IF NOT EXISTS execution_summary TEXT;  -- what Abra actually did
