-- AP/AR Invoices table — tracks accounts payable and receivable
-- Powers the aging dashboard at /api/ops/abra/ap-ar

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('payable', 'receivable')),
  counterparty TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  paid_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  reference TEXT, -- PO number, invoice number, etc.
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_type ON invoices(type);
CREATE INDEX idx_invoices_counterparty ON invoices(counterparty);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON invoices
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_invoices_updated_at();

-- Seed: Known payable — Powers Confections 50K unit production run
INSERT INTO invoices (type, counterparty, description, amount, invoice_date, due_date, status, reference, notes)
VALUES (
  'payable',
  'Powers Confections',
  '50K unit production run — All American Gummy Bears',
  162500.00,
  '2026-03-10',
  '2026-04-15',
  'pending',
  'PO-2026-001',
  'Scale-up production run. Quote confirmed with Powers. 50% deposit, 50% on delivery.'
);
