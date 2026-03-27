CREATE TABLE IF NOT EXISTS public.abra_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_entity_id TEXT,
  units INTEGER,
  unit_price NUMERIC(10,2),
  subtotal NUMERIC(10,2),
  shipping_cost NUMERIC(10,2),
  total NUMERIC(10,2),
  delivery_address TEXT,
  requested_delivery_date DATE,
  payment_terms TEXT DEFAULT 'Net 30',
  status TEXT NOT NULL DEFAULT 'received',
  qbo_invoice_id TEXT,
  tracking_number TEXT,
  tracking_carrier TEXT,
  estimated_delivery DATE,
  payment_date DATE,
  payment_amount NUMERIC(10,2),
  source_email_id TEXT,
  notes TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abra_po_status ON public.abra_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_abra_po_customer ON public.abra_purchase_orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_abra_po_number ON public.abra_purchase_orders(po_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_abra_po_number_unique ON public.abra_purchase_orders(po_number);

CREATE OR REPLACE FUNCTION public.set_abra_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_abra_purchase_orders_updated_at ON public.abra_purchase_orders;
CREATE TRIGGER trg_abra_purchase_orders_updated_at
BEFORE UPDATE ON public.abra_purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_abra_purchase_orders_updated_at();
