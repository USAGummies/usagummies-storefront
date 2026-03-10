-- ============================================================================
-- Abra OS — Learning Infrastructure (Corrections, Departments, Questions)
-- Created: 2026-03-10
-- ============================================================================

-- 1. Expand entry_type constraint to allow 'correction' and 'teaching'
ALTER TABLE public.open_brain_entries
  DROP CONSTRAINT IF EXISTS open_brain_entries_entry_type_check;

ALTER TABLE public.open_brain_entries
  ADD CONSTRAINT open_brain_entries_entry_type_check
  CHECK (entry_type IN (
    'finding', 'research', 'field_note', 'summary',
    'alert', 'system_log', 'correction', 'teaching'
  ));

-- 2. abra_corrections — Explicit corrections from users that override stale data
CREATE TABLE IF NOT EXISTS public.abra_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corrected_by TEXT NOT NULL,
  original_claim TEXT NOT NULL,
  correction TEXT NOT NULL,
  department TEXT,
  active BOOLEAN DEFAULT TRUE,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_corrections_active ON public.abra_corrections(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_corrections_created ON public.abra_corrections(created_at DESC);

ALTER TABLE public.abra_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on abra_corrections"
  ON public.abra_corrections FOR ALL
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read corrections"
  ON public.abra_corrections FOR SELECT
  TO authenticated USING (true);

-- 3. abra_departments — Department registry with owners and context
CREATE TABLE IF NOT EXISTS public.abra_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT,
  description TEXT,
  key_context TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.abra_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on abra_departments"
  ON public.abra_departments FOR ALL
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read departments"
  ON public.abra_departments FOR SELECT
  TO authenticated USING (true);

-- Auto-update trigger for departments
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.abra_departments;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.abra_departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed departments
INSERT INTO public.abra_departments (name, owner_name, owner_email, description, key_context) VALUES
  ('executive', 'Ben Stutman', 'ben@usagummies.com',
   'CEO and founder. Oversees all strategy, fundraising, and growth.',
   'Ben makes all final decisions. He is the only person who can approve large expenditures, new partnerships, or strategic pivots.'),
  ('operations', 'Andrew Slater', NULL,
   'Operations manager. Handles production, supply chain, fulfillment, and vendor relationships.',
   'Andrew manages the relationship with Powers Confections (repacker in Spokane, WA). He coordinates production runs, shipping logistics, and inventory.'),
  ('finance', 'Rene Gonzalez', NULL,
   'Finance lead. Handles accounting, bookkeeping, cash flow, and financial reporting.',
   'Rene manages QuickBooks, tracks cash transactions, handles invoicing. Ask him about financial structure, accounting practices, and budget questions.'),
  ('sales_and_growth', 'Ben Stutman', 'ben@usagummies.com',
   'Sales, marketing, B2B outreach, DTC growth, and channel expansion.',
   'Covers Shopify DTC, Amazon marketplace, wholesale/distributor outreach, and retail placement. Ben leads this directly.'),
  ('supply_chain', 'Andrew Slater', NULL,
   'Raw materials sourcing, production scheduling, and logistics.',
   'Includes ingredient suppliers, Powers Confections production, packaging vendors, and freight/shipping coordination.')
ON CONFLICT (name) DO NOTHING;

-- 4. abra_unanswered_questions — Questions Abra couldn't confidently answer
CREATE TABLE IF NOT EXISTS public.abra_unanswered_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  asked_by TEXT,
  context TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'dismissed')),
  answer TEXT,
  answered_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unanswered_status ON public.abra_unanswered_questions(status);
CREATE INDEX IF NOT EXISTS idx_unanswered_created ON public.abra_unanswered_questions(created_at DESC);

ALTER TABLE public.abra_unanswered_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on abra_unanswered_questions"
  ON public.abra_unanswered_questions FOR ALL
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read questions"
  ON public.abra_unanswered_questions FOR SELECT
  TO authenticated USING (true);
