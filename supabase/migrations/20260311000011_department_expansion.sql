-- Department Expansion: 5 → 20 departments
-- Adds 15 new departments to match full company org chart.
-- Restructures existing departments with sub-department context.
-- Adds operating_pillar column and executive_role mapping.

-- 1. Add new columns to abra_departments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'operating_pillar'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN operating_pillar TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'executive_role'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN executive_role TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'sub_departments'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN sub_departments JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'abra_departments' AND column_name = 'parent_department'
  ) THEN
    ALTER TABLE public.abra_departments ADD COLUMN parent_department TEXT;
  END IF;
END $$;

-- 2. Update existing departments with new columns
UPDATE public.abra_departments SET
  operating_pillar = 'control_the_business',
  executive_role = 'CEO',
  sub_departments = '["Strategy & Corporate Development", "Executive Operations & Chief of Staff", "Investor Relations & Fundraising"]'::jsonb
WHERE name = 'executive';

UPDATE public.abra_departments SET
  operating_pillar = 'control_the_business',
  executive_role = 'CFO',
  sub_departments = '["FP&A (Financial Planning & Analysis)", "Accounting & Bookkeeping", "Treasury & Cash Management", "Commercial Finance (Channel P&L)", "Cost Accounting & Unit Economics"]'::jsonb
WHERE name = 'finance';

UPDATE public.abra_departments SET
  operating_pillar = 'build_the_product',
  executive_role = 'President/COO',
  description = 'Manufacturing and production operations — co-packing, process optimization, packaging assembly.',
  sub_departments = '["Production Planning & Scheduling", "Co-Packing Management", "Process Optimization", "Packaging & Assembly", "Maintenance & Equipment"]'::jsonb
WHERE name = 'operations';

UPDATE public.abra_departments SET
  operating_pillar = 'sell_the_product',
  executive_role = 'CRO',
  sub_departments = '["DTC Sales", "Amazon/Marketplace Sales", "Wholesale & Distributor Sales", "Retail & Chain Account Sales", "International Sales (future)", "Sales Operations & Enablement"]'::jsonb
WHERE name = 'sales_and_growth';

UPDATE public.abra_departments SET
  operating_pillar = 'move_the_product',
  executive_role = 'CSCO',
  sub_departments = '["Procurement & Sourcing", "Demand Planning & Forecasting", "Logistics & Transportation", "Warehouse & Distribution", "Inventory Management"]'::jsonb
WHERE name = 'supply_chain';

-- 3. Insert 15 new departments
INSERT INTO public.abra_departments (name, owner_name, owner_email, description, key_context, operating_pillar, executive_role, sub_departments) VALUES

  -- Control the Business pillar
  ('legal', 'Ben Stutman', 'ben@usagummies.com',
   'Legal, risk management, corporate governance, contracts, IP protection, and FDA regulatory compliance.',
   'Handles contracts, intellectual property, FDA/food safety regulations, insurance, liability, and corporate governance. Critical for CPG regulatory compliance.',
   'control_the_business', 'GC',
   '["Contracts & Intellectual Property", "Regulatory & FDA Compliance", "Insurance & Liability", "Corporate Governance"]'::jsonb),

  ('people', 'Ben Stutman', 'ben@usagummies.com',
   'AI systems administration, agent performance optimization, workforce automation, and AI training. This department manages AI agents, NOT human employees.',
   'People/HR is reframed for AI operations. Manages AI agent deployment, performance monitoring, capability optimization, and automated workflow design. Human hiring is handled directly by department heads.',
   'control_the_business', 'CPO (AI)',
   '["AI Systems Administration", "Agent Performance & Optimization", "Workforce Automation", "AI Training & Development"]'::jsonb),

  ('data_analytics', 'Ben Stutman', 'ben@usagummies.com',
   'Business intelligence, dashboards, advanced analytics, data engineering, and consumer insights.',
   'Owns the data infrastructure: GA4, Supabase analytics, Shopify/Amazon data pipelines, customer segmentation, and predictive modeling.',
   'control_the_business', 'CIO/CDO',
   '["Business Intelligence & Dashboards", "Advanced Analytics & Modeling", "Data Engineering & Infrastructure", "Consumer Insights"]'::jsonb),

  ('it', 'Ben Stutman', 'ben@usagummies.com',
   'Engineering, development, infrastructure, cloud ops, cybersecurity, and vendor tech management.',
   'Manages the tech stack: Next.js storefront, Vercel deployment, Supabase, Shopify integrations, Amazon SP-API, and all SaaS tools.',
   'control_the_business', 'CIO/CDO',
   '["Engineering & Development", "Infrastructure & Cloud Ops", "Cybersecurity & Compliance", "Vendor Tech Management"]'::jsonb),

  ('corporate_affairs', 'Ben Stutman', 'ben@usagummies.com',
   'Public relations, government affairs, CSR, and internal communications.',
   'Manages public image, media relations, government/regulatory affairs for food industry, corporate social responsibility, and internal company communications.',
   'control_the_business', 'CEO',
   '["Public Relations & Media", "Government & Regulatory Affairs", "Corporate Social Responsibility", "Internal Communications"]'::jsonb),

  -- Build the Product pillar
  ('product', 'Ben Stutman', 'ben@usagummies.com',
   'R&D, new product development, ingredient standards, packaging innovation, and product portfolio strategy.',
   'Drives product roadmap: new flavors, formulations, dietary variants (vegan, sugar-free), packaging design, and SKU portfolio management.',
   'build_the_product', 'CPO (Product)',
   '["R&D / New Product Development", "Ingredient Standards & Sourcing Specs", "Packaging Innovation", "Product Portfolio Strategy"]'::jsonb),

  ('quality', 'Ben Stutman', 'ben@usagummies.com',
   'Quality assurance, food safety, HACCP compliance, regulatory compliance, and lab/testing oversight.',
   'Ensures all products meet FDA regulations, food safety standards, HACCP protocols, shelf-life testing, and ingredient quality verification.',
   'build_the_product', 'CQO',
   '["QA / Quality Control", "Food Safety & HACCP", "Regulatory Compliance (FDA, State)", "Lab & Testing Oversight"]'::jsonb),

  -- Move the Product pillar
  ('retail_execution', 'Ben Stutman', 'ben@usagummies.com',
   'Field sales coverage, merchandising audits, store-level data capture, and event/demo execution.',
   'Manages on-the-ground retail presence: field reps, shelf placement audits, in-store demos, promotional compliance, and store-level sales data.',
   'move_the_product', 'CRO',
   '["Field Sales / Rep Coverage", "Merchandising Audits", "Store-Level Data Capture", "Event & Demo Execution"]'::jsonb),

  -- Sell the Product pillar
  ('trade_marketing', 'Ben Stutman', 'ben@usagummies.com',
   'In-store promotions, retailer marketing programs, category insights, and planogram/shelf strategy.',
   'Bridge between marketing and sales: manages trade promotions, retailer co-op programs, category management insights, and shelf placement strategy.',
   'sell_the_product', 'CMO',
   '["In-Store Promotion & Merchandising", "Retailer Marketing Programs", "Category Insights & Analytics", "Planogram & Shelf Strategy"]'::jsonb),

  ('amazon', 'Ben Stutman', 'ben@usagummies.com',
   'Amazon account management, PPC/sponsored ads, listing optimization, FBA/FBM logistics, reviews, and brand protection.',
   'Center of excellence for Amazon marketplace: manages Seller Central account (A16G27VYDSSEGO), PPC campaigns, listing SEO, FBA inventory, review management, and Brand Registry.',
   'sell_the_product', 'CRO',
   '["Amazon Account Management", "PPC / Sponsored Ads", "Listing Optimization & A+ Content", "Amazon Logistics (FBA/FBM)", "Reviews & Reputation Management", "Brand Registry & Protection"]'::jsonb),

  -- Grow the Brand pillar
  ('marketing', 'Ben Stutman', 'ben@usagummies.com',
   'Brand marketing, growth/performance marketing, content creation, social media, influencer partnerships.',
   'Owns brand identity, growth campaigns, paid media, content strategy, social channels, community building, and influencer/partnership programs.',
   'grow_the_brand', 'CMO',
   '["Brand Marketing & Strategy", "Growth Marketing & Performance", "Content & Creative", "Social Media & Community", "Influencer & Partnerships"]'::jsonb),

  ('ecommerce', 'Ben Stutman', 'ben@usagummies.com',
   'Shopify store management, CRO, email/SMS marketing, subscription/loyalty, and customer data personalization.',
   'Manages the DTC digital storefront: Shopify store optimization, conversion rate optimization, Klaviyo email/SMS flows, subscription programs, and customer segmentation.',
   'grow_the_brand', 'CMO',
   '["Shopify Store Management", "CRO / Site Optimization", "Email & SMS Marketing", "Subscription & Loyalty Programs", "Customer Data & Personalization"]'::jsonb),

  ('customer_experience', 'Ben Stutman', 'ben@usagummies.com',
   'Customer service, returns/warranty, voice of customer programs, NPS tracking.',
   'Manages all post-purchase customer touchpoints: support tickets, returns processing, customer feedback collection, NPS surveys, and satisfaction tracking.',
   'grow_the_brand', 'CMO',
   '["Customer Service & Support", "Returns & Warranty", "Voice of Customer / Feedback", "NPS & Satisfaction Tracking"]'::jsonb),

  ('brand_studio', 'Ben Stutman', 'ben@usagummies.com',
   'In-house creative agency, content production, brand collaborations, and media distribution.',
   'Functions as an internal media company: produces branded content, manages creative assets, handles brand partnership deals, and distributes content across channels.',
   'grow_the_brand', 'CMO',
   '["In-House Creative Agency", "Content Production (Video/Photo/Design)", "Brand Partnerships & Collaborations", "Media Distribution & Publishing"]'::jsonb),

  ('research_lab', 'Ben Stutman', 'ben@usagummies.com',
   'Consumer testing, product sensory evaluation, market research, and competitive analysis.',
   'Runs consumer focus groups, taste tests, sensory evaluations, market research studies, and competitive intelligence gathering.',
   'build_the_product', 'CPO (Product)',
   '["Consumer Testing & Focus Groups", "Product Testing & Sensory Evaluation", "Market Research", "Competitive Analysis"]'::jsonb)

ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  key_context = EXCLUDED.key_context,
  operating_pillar = EXCLUDED.operating_pillar,
  executive_role = EXCLUDED.executive_role,
  sub_departments = EXCLUDED.sub_departments;

-- 4. Create operating_pillars reference table
CREATE TABLE IF NOT EXISTS public.abra_operating_pillars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  departments TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abra_operating_pillars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on abra_operating_pillars"
  ON public.abra_operating_pillars FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Anon read on abra_operating_pillars"
  ON public.abra_operating_pillars FOR SELECT USING (true);

INSERT INTO public.abra_operating_pillars (id, name, description, departments) VALUES
  ('build_the_product', 'Build the Product',
   'Product development, quality assurance, manufacturing, and R&D.',
   ARRAY['product', 'quality', 'operations', 'research_lab']),
  ('move_the_product', 'Move the Product',
   'Supply chain, logistics, distribution, and retail execution.',
   ARRAY['supply_chain', 'retail_execution']),
  ('sell_the_product', 'Sell the Product',
   'Direct sales, trade marketing, Amazon/marketplace, and channel management.',
   ARRAY['sales_and_growth', 'trade_marketing', 'amazon']),
  ('grow_the_brand', 'Grow the Brand',
   'Marketing, ecommerce/DTC, brand studio, customer experience.',
   ARRAY['marketing', 'ecommerce', 'brand_studio', 'customer_experience']),
  ('control_the_business', 'Control the Business',
   'Finance, legal, data/analytics, IT, corporate affairs, and executive leadership.',
   ARRAY['finance', 'legal', 'data_analytics', 'it', 'corporate_affairs', 'executive', 'people'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  departments = EXCLUDED.departments;

-- 5. Create executive roles reference
CREATE TABLE IF NOT EXISTS public.abra_executive_roles (
  role TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  full_name TEXT,
  departments TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abra_executive_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on abra_executive_roles"
  ON public.abra_executive_roles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Anon read on abra_executive_roles"
  ON public.abra_executive_roles FOR SELECT USING (true);

INSERT INTO public.abra_executive_roles (role, title, full_name, departments) VALUES
  ('CEO', 'Chief Executive Officer', 'Ben Stutman', ARRAY['executive', 'corporate_affairs']),
  ('President/COO', 'President & Chief Operating Officer', NULL, ARRAY['operations']),
  ('CFO', 'Chief Financial Officer', 'Rene Gonzalez', ARRAY['finance']),
  ('CRO', 'Chief Revenue Officer', NULL, ARRAY['sales_and_growth', 'amazon', 'retail_execution']),
  ('CMO', 'Chief Marketing Officer', NULL, ARRAY['marketing', 'ecommerce', 'trade_marketing', 'brand_studio', 'customer_experience']),
  ('CSCO', 'Chief Supply Chain Officer', 'Andrew Slater', ARRAY['supply_chain']),
  ('CPO_Product', 'Chief Product Officer', NULL, ARRAY['product', 'research_lab']),
  ('CQO', 'Chief Quality Officer', NULL, ARRAY['quality']),
  ('GC', 'General Counsel', NULL, ARRAY['legal']),
  ('CPO_AI', 'Chief People Officer (AI Systems)', NULL, ARRAY['people']),
  ('CIO_CDO', 'Chief Information / Data Officer', NULL, ARRAY['it', 'data_analytics'])
ON CONFLICT (role) DO UPDATE SET
  title = EXCLUDED.title,
  departments = EXCLUDED.departments;
