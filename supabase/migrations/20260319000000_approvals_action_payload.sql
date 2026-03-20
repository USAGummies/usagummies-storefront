-- Add action_payload column to approvals table
-- Stores the full action directive that was proposed for approval,
-- enabling audit trails and re-execution after approval.

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS action_payload JSONB;

COMMENT ON COLUMN public.approvals.action_payload IS
  'Full action directive JSON as emitted by the LLM, for audit and re-execution.';
