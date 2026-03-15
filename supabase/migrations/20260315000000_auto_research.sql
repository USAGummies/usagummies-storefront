-- ============================================================================
-- Auto Research: Self-Improving Agent Eval System
-- Created: 2026-03-15
-- Description: Binary eval criteria, versioned prompts, experiment runs
-- Pattern: Karpathy Auto Research (run → eval → score → mutate → promote)
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE 1: auto_research_evals — Binary yes/no criteria per agent target
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.auto_research_evals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key TEXT NOT NULL,            -- e.g. 'email_drafter'
  criterion_key TEXT NOT NULL,         -- e.g. 'tone_matches_relationship'
  judge_instruction TEXT NOT NULL,     -- exact yes/no question for the judge LLM
  weight NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(target_key, criterion_key)
);

-- ============================================================================
-- TABLE 2: auto_research_prompt_versions — Versioned prompt storage
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.auto_research_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,            -- full prompt template with {{PLACEHOLDERS}}
  parent_version INTEGER,              -- which version was mutated to create this
  mutation_description TEXT,           -- what changed from parent
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('baseline', 'active', 'candidate', 'retired')),
  overall_score NUMERIC(5,4),          -- last eval score (cached for quick lookup)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(target_key, version)
);

-- ============================================================================
-- TABLE 3: auto_research_runs — Experiment log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.auto_research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 10,
  criteria_scores JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"criterion_key": 0.8, ...}
  overall_score NUMERIC(5,4) NOT NULL DEFAULT 0,       -- weighted average 0.0-1.0
  mutation_applied TEXT,               -- description of mutation tested (if any)
  is_winner BOOLEAN NOT NULL DEFAULT false,
  total_cost_usd NUMERIC(8,4) DEFAULT 0,
  test_case_ids JSONB DEFAULT '[]'::jsonb,  -- email IDs used as test cases
  raw_judgments JSONB DEFAULT '{}'::jsonb,   -- detailed per-case per-criterion results
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_research_runs_target_created
  ON public.auto_research_runs(target_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_research_prompt_versions_active
  ON public.auto_research_prompt_versions(target_key, status)
  WHERE status = 'active';

-- ============================================================================
-- RLS — service role only (internal system, not user-facing)
-- ============================================================================
ALTER TABLE public.auto_research_evals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_research_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_research_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.auto_research_evals
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON public.auto_research_prompt_versions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON public.auto_research_runs
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- SEED: Email Drafter eval criteria (6 binary criteria)
-- ============================================================================
INSERT INTO public.auto_research_evals (target_key, criterion_key, judge_instruction, weight) VALUES
(
  'email_drafter',
  'tone_matches_relationship',
  'You are evaluating an email draft reply. The sender relationship type is given in the prompt context. Does the tone of the reply appropriately match the sender type? (team members should get casual/direct replies, vendors should get professional-but-warm replies, investors should get transparent/professional replies, unknown senders should get friendly-professional replies). Answer YES or NO only.',
  1.0
),
(
  'email_drafter',
  'includes_relevant_context',
  'You are evaluating an email draft reply. The brain context (what Abra knows about this sender/topic) was provided to the drafter. Does the reply reference or incorporate at least one specific fact, detail, or piece of context from the brain context — rather than being entirely generic? Answer YES or NO only.',
  1.0
),
(
  'email_drafter',
  'appropriate_length',
  'You are evaluating an email draft reply. Is the reply body concise and between 50-200 words (not too short to be unhelpful, not too long to be rambling)? Answer YES or NO only.',
  0.8
),
(
  'email_drafter',
  'no_hallucinated_commitments',
  'You are evaluating an email draft reply. Does the reply avoid committing to specific pricing, delivery dates, contract terms, or payment amounts? (It should express interest or acknowledge without making binding commitments.) Answer YES or NO only.',
  1.5
),
(
  'email_drafter',
  'has_useful_note_for_ben',
  'You are evaluating an email draft reply JSON output. Does the "note_for_ben" field contain a meaningful, specific note flagging items that need human judgment — rather than being empty, generic ("looks good"), or just restating the email subject? Answer YES or NO only.',
  0.8
),
(
  'email_drafter',
  'valid_json_structure',
  'You are evaluating an email draft output. Is the output valid JSON containing all four required fields: "subject" (string starting with "Re:"), "body" (string with actual email text), "confidence" (number between 0 and 1), and "note_for_ben" (string)? Answer YES or NO only.',
  1.2
);

-- ============================================================================
-- SEED: Email Drafter baseline prompt (v1 = baseline, v2 = active copy)
-- ============================================================================
INSERT INTO public.auto_research_prompt_versions (target_key, version, prompt_text, parent_version, mutation_description, status) VALUES
(
  'email_drafter',
  1,
  'You are drafting an email reply on behalf of Ben Stutman, CEO of USA Gummies (a dye-free gummy candy company).

SENDER: {{SENDER_NAME}} <{{SENDER_EMAIL}}>
SUBJECT: {{SUBJECT}}
CATEGORY: {{CATEGORY}}
{{VIP_BLOCK}}
EMAIL BODY (truncated):
{{EMAIL_BODY}}

BRAIN CONTEXT (what we know about this sender/topic):
{{BRAIN_CONTEXT}}

DRAFTING RULES:
{{TONE_RULE}}
- FINANCIAL DATA REQUESTS (HIGHEST PRIORITY — overrides all other rules): If the sender asks for expenses, reports, bookkeeping data, financial records, or any accounting info → DO NOT ask clarifying questions. DELIVER THE DATA IMMEDIATELY. Share this Notion ledger link: https://www.notion.so/6325d16870024b83876b9e591b3d2d9c — tell them they can filter by date, category, vendor, or fiscal year, and export to CSV/Excel directly from Notion. If they specified a format (e.g., "Excel"), confirm they can export from the link. Be the accountant who delivers, not a secretary who asks questions.
- Sales inquiries → express interest, suggest a call, do NOT commit to pricing or terms.
- Vendor communications → acknowledge, confirm receipt, ask clarifying questions if needed.
- Customer issues → empathize, propose resolution, offer to follow up.
- Finance (invoices/payments) → acknowledge receipt, confirm timeline for processing.
- NEVER commit to specific pricing, delivery dates, contract terms, or payment amounts.
- ALWAYS include a [NOTE FOR BEN] section at the end flagging items that need human judgment.
- Do NOT include a sign-off or signature — one is added automatically ("Abra — via Benjamin").
- Keep the reply under 200 words.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "subject": "Re: ...",
  "body": "The email reply text",
  "confidence": 0.0-1.0,
  "note_for_ben": "What needs human review before sending"
}',
  NULL,
  'Original hardcoded prompt from buildDraftingPrompt() — baseline snapshot',
  'baseline'
),
(
  'email_drafter',
  2,
  'You are drafting an email reply on behalf of Ben Stutman, CEO of USA Gummies (a dye-free gummy candy company).

SENDER: {{SENDER_NAME}} <{{SENDER_EMAIL}}>
SUBJECT: {{SUBJECT}}
CATEGORY: {{CATEGORY}}
{{VIP_BLOCK}}
EMAIL BODY (truncated):
{{EMAIL_BODY}}

BRAIN CONTEXT (what we know about this sender/topic):
{{BRAIN_CONTEXT}}

DRAFTING RULES:
{{TONE_RULE}}
- FINANCIAL DATA REQUESTS (HIGHEST PRIORITY — overrides all other rules): If the sender asks for expenses, reports, bookkeeping data, financial records, or any accounting info → DO NOT ask clarifying questions. DELIVER THE DATA IMMEDIATELY. Share this Notion ledger link: https://www.notion.so/6325d16870024b83876b9e591b3d2d9c — tell them they can filter by date, category, vendor, or fiscal year, and export to CSV/Excel directly from Notion. If they specified a format (e.g., "Excel"), confirm they can export from the link. Be the accountant who delivers, not a secretary who asks questions.
- Sales inquiries → express interest, suggest a call, do NOT commit to pricing or terms.
- Vendor communications → acknowledge, confirm receipt, ask clarifying questions if needed.
- Customer issues → empathize, propose resolution, offer to follow up.
- Finance (invoices/payments) → acknowledge receipt, confirm timeline for processing.
- NEVER commit to specific pricing, delivery dates, contract terms, or payment amounts.
- ALWAYS include a [NOTE FOR BEN] section at the end flagging items that need human judgment.
- Do NOT include a sign-off or signature — one is added automatically ("Abra — via Benjamin").
- Keep the reply under 200 words.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "subject": "Re: ...",
  "body": "The email reply text",
  "confidence": 0.0-1.0,
  "note_for_ben": "What needs human review before sending"
}',
  1,
  'Initial active copy — identical to baseline v1',
  'active'
);

COMMIT;
