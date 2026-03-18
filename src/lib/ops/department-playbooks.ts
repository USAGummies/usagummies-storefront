/**
 * Department Playbooks — Built-in templates for department initiatives
 *
 * These avoid expensive research calls for well-known business structures.
 * Each playbook defines baseline requirements, clarifying questions,
 * task templates, and KPIs for a department.
 */

export type PlaybookQuestion = {
  key: string;
  q: string;
  default?: string;
  options?: string[];
};

export type PlaybookTask = {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  depends_on?: string[];
  estimated_hours?: number;
};

export type DepartmentPlaybook = {
  baseline: string[];
  questions: PlaybookQuestion[];
  taskTemplate: PlaybookTask[];
  kpis: string[];
  description: string;
};

export const DEPARTMENT_PLAYBOOKS: Record<string, DepartmentPlaybook> = {
  finance: {
    description:
      "Financial operations for a CPG/DTC gummy candy company with wholesale and marketplace channels.",
    baseline: [
      "Chart of accounts (QuickBooks-ready)",
      "Accounts receivable tracking",
      "Accounts payable tracking",
      "Bank reconciliation process",
      "Revenue recognition (DTC + wholesale + Amazon)",
      "COGS tracking (per-unit: ingredients, packaging, labor, freight)",
      "Inventory valuation (weighted average)",
      "Sales tax compliance (multi-state nexus)",
      "Monthly close process",
      "Cash flow forecasting",
      "Vendor payment schedule",
      "Payroll processing",
      "Financial reporting (P&L, balance sheet, cash flow statement)",
    ],
    questions: [
      {
        key: "accounting_basis",
        q: "Cash or accrual basis? (Recommend accrual for CPG companies)",
        default: "accrual",
        options: ["cash", "accrual"],
      },
      {
        key: "fiscal_year",
        q: "Calendar year (Jan-Dec) or custom fiscal year?",
        default: "calendar",
        options: ["calendar", "custom"],
      },
      {
        key: "bank_accounts",
        q: "How many bank accounts? Separate for ops vs payroll?",
      },
      {
        key: "payroll",
        q: "Payroll in-house or through a service (Gusto, ADP)?",
        default: "service",
        options: ["in-house", "service"],
      },
      {
        key: "tax_structure",
        q: "Business entity type? (LLC, S-Corp, C-Corp)",
        options: ["LLC", "S-Corp", "C-Corp"],
      },
      {
        key: "bookkeeper",
        q: "Do you have a bookkeeper/accountant, or need to find one?",
        options: ["have one", "need one"],
      },
      {
        key: "revenue_streams",
        q: "Which revenue streams to track separately? (DTC, Amazon, Wholesale, Faire)",
        default: "DTC, Amazon, Wholesale, Faire",
      },
      {
        key: "existing_data",
        q: "Where is current financial data? (Spreadsheets, bank statements, QuickBooks, nothing?)",
      },
      {
        key: "sales_tax",
        q: "Which states do you have sales tax nexus in?",
      },
      {
        key: "inventory_method",
        q: "Inventory valuation method? (Weighted average recommended for CPG)",
        default: "weighted_average",
        options: ["weighted_average", "FIFO", "LIFO"],
      },
    ],
    taskTemplate: [
      {
        title: "Set up chart of accounts",
        description:
          "Create a QuickBooks-ready chart of accounts with categories for COGS (ingredients, packaging, labor, freight), revenue by channel (DTC, Amazon, Wholesale), operating expenses, and owner equity.",
        priority: "critical",
        estimated_hours: 4,
      },
      {
        title: "Configure {accounting_basis} accounting basis",
        description:
          "Configure bookkeeping workflows for {accounting_basis} accounting and align month-end close procedures with the selected basis.",
        priority: "critical",
        estimated_hours: 2,
      },
      {
        title: "Configure accounts receivable",
        description:
          "Set up AR tracking for wholesale customers, Faire orders, and any net-30/60 terms. Include aging buckets (current, 30, 60, 90+ days).",
        priority: "critical",
        estimated_hours: 2,
      },
      {
        title: "Configure accounts payable",
        description:
          "Set up AP tracking for ingredient suppliers, packaging vendors, co-packer (Powers Confections), freight carriers, and recurring services.",
        priority: "critical",
        estimated_hours: 2,
      },
      {
        title: "Establish bank reconciliation process",
        description:
          "Define monthly bank rec workflow — match transactions, categorize, flag discrepancies. Automate where possible via bank feeds.",
        priority: "high",
        estimated_hours: 2,
      },
      {
        title: "Build COGS tracking model",
        description:
          "Create per-unit COGS breakdown: ingredients, packaging, labor (co-packer fees), inbound freight. Track by product SKU.",
        priority: "high",
        estimated_hours: 4,
      },
      {
        title: "Set up revenue recognition by channel",
        description:
          "Configure separate revenue tracking for {revenue_streams}, including marketplace fees, wholesale terms, and channel-specific adjustments.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Configure sales tax compliance",
        description:
          "Set up sales tax collection for nexus states ({sales_tax}), configure automated remittance when possible, and document exemption certificates for wholesale.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Create monthly close checklist",
        description:
          "Define month-end close process: reconcile all accounts, review AR aging, verify inventory counts, generate P&L and balance sheet, review budget variance.",
        priority: "medium",
        estimated_hours: 2,
      },
      {
        title: "Build cash flow forecast model",
        description:
          "Create 13-week rolling cash flow forecast incorporating expected receipts, payables, inventory purchases, and seasonal patterns.",
        priority: "medium",
        estimated_hours: 4,
      },
      {
        title: "Set up financial reporting cadence",
        description:
          "Establish monthly P&L, balance sheet, cash flow statement. Weekly cash position report. Quarterly board-ready package.",
        priority: "medium",
        estimated_hours: 2,
      },
    ],
    kpis: [
      "monthly_close_time_days",
      "ar_aging_over_30d_usd",
      "ap_aging_over_30d_usd",
      "cash_runway_days",
      "gross_margin_pct",
      "cogs_per_unit",
      "revenue_by_channel",
      "burn_rate_monthly",
    ],
  },

  operations: {
    description:
      "Day-to-day operations for a CPG company — production, shipping, quality, and supply chain.",
    baseline: [
      "Production run planning and scheduling",
      "Co-packer relationship management",
      "Quality control checkpoints",
      "Shipping and fulfillment SOP",
      "Inventory management (raw materials + finished goods)",
      "Vendor management and procurement",
      "Warehouse/3PL coordination",
      "Batch tracking and lot codes",
      "Returns and damage handling",
      "Compliance documentation (FDA, state regulations)",
    ],
    questions: [
      {
        key: "co_packer",
        q: "Who is your co-packer? (We have Powers Confections in Spokane, WA on file)",
        default: "Powers Confections",
      },
      {
        key: "fulfillment",
        q: "How is fulfillment handled? (In-house, 3PL, FBA, mix?)",
      },
      {
        key: "production_frequency",
        q: "How often are production runs? (Weekly, biweekly, monthly, as-needed?)",
      },
      {
        key: "inventory_location",
        q: "Where is inventory stored? (Warehouse, 3PL, co-packer, FBA?)",
      },
      {
        key: "qc_process",
        q: "What quality control checks exist? (Lab testing, visual inspection, retention samples?)",
      },
      {
        key: "shipping_carriers",
        q: "Preferred shipping carriers for DTC and wholesale?",
      },
    ],
    taskTemplate: [
      {
        title: "Document production run SOP",
        description:
          "Create standard operating procedure for production runs: ingredients ordering → co-packer scheduling → QC → receiving → warehousing.",
        priority: "critical",
        estimated_hours: 4,
      },
      {
        title: "Set up inventory tracking system",
        description:
          "Implement raw materials and finished goods tracking with reorder points, safety stock levels, and lot/batch traceability.",
        priority: "critical",
        estimated_hours: 6,
      },
      {
        title: "Create vendor management database",
        description:
          "Catalog all vendors (ingredients, packaging, freight) with contact info, terms, lead times, and minimum order quantities.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Build production planning calendar",
        description:
          "Build a rolling {production_frequency} production schedule based on sales velocity, inventory levels, and seasonal demand patterns.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Document inventory locations and ownership",
        description:
          "Map inventory ownership and transfer points across {inventory_location} to reduce handoff delays and mismatched counts.",
        priority: "medium",
        estimated_hours: 2,
      },
    ],
    kpis: [
      "production_lead_time_days",
      "inventory_turns_per_year",
      "stockout_rate_pct",
      "on_time_delivery_pct",
      "cost_per_unit_shipped",
      "return_rate_pct",
    ],
  },

  sales_and_growth: {
    description:
      "Revenue growth across DTC, wholesale, and marketplace channels for a gummy candy brand.",
    baseline: [
      "Sales pipeline management",
      "B2B outreach and prospecting",
      "DTC conversion optimization",
      "Amazon listing optimization",
      "Wholesale pricing and terms",
      "Trade show and event planning",
      "Customer acquisition cost tracking",
      "Retention and repeat purchase programs",
      "Channel-specific P&L",
      "Sales forecasting",
    ],
    questions: [
      {
        key: "channels",
        q: "Which sales channels are active? (Shopify DTC, Amazon, Wholesale, Faire?)",
        default: "Shopify DTC, Amazon, Wholesale, Faire",
      },
      {
        key: "target_accounts",
        q: "Target wholesale accounts? (Natural grocers, specialty, convenience, big box?)",
      },
      {
        key: "pricing_tiers",
        q: "Do you have wholesale pricing tiers (volume discounts)?",
      },
      {
        key: "marketing_budget",
        q: "Monthly marketing/advertising budget?",
      },
      {
        key: "crm",
        q: "What CRM or pipeline tool is used? (Notion, HubSpot, spreadsheet?)",
        default: "Notion",
      },
    ],
    taskTemplate: [
      {
        title: "Build sales pipeline tracking",
        description:
          "Formalize lead → prospect → sample → first order → repeat pipeline with stages and conversion metrics.",
        priority: "critical",
        estimated_hours: 4,
      },
      {
        title: "Prioritize active sales channels",
        description:
          "Set a channel strategy for {channels} with clear weekly ownership, target revenue, and escalation paths for blocked deals.",
        priority: "high",
        estimated_hours: 2,
      },
      {
        title: "Create wholesale rate card",
        description:
          "Develop tiered wholesale pricing for {target_accounts}: case pricing, pallet pricing, distributor pricing, plus minimum order quantities and payment terms.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Optimize DTC funnel",
        description:
          "Audit Shopify store: product pages, checkout flow, upsells, email capture. Implement abandoned cart and post-purchase flows.",
        priority: "high",
        estimated_hours: 6,
      },
    ],
    kpis: [
      "monthly_revenue_by_channel",
      "customer_acquisition_cost",
      "repeat_purchase_rate",
      "wholesale_pipeline_value",
      "amazon_organic_rank",
      "dtc_conversion_rate",
    ],
  },

  supply_chain: {
    description:
      "End-to-end supply chain for a CPG gummy candy company — sourcing, production, distribution.",
    baseline: [
      "Ingredient sourcing and supplier relationships",
      "Packaging procurement",
      "Co-packer capacity planning",
      "Inbound freight management",
      "Outbound logistics (DTC, wholesale, FBA)",
      "Lead time management",
      "Safety stock calculations",
      "Demand forecasting",
      "Supplier diversification strategy",
      "Cold chain management (if applicable)",
    ],
    questions: [
      {
        key: "ingredient_suppliers",
        q: "How many ingredient suppliers? Single-source or diversified?",
      },
      {
        key: "lead_times",
        q: "Typical ingredient lead times? (Days from order to delivery)",
      },
      {
        key: "packaging_supplier",
        q: "Packaging supplier(s) and lead times?",
      },
      {
        key: "seasonal_demand",
        q: "Are there seasonal demand spikes? (Halloween, holidays, summer?)",
      },
    ],
    taskTemplate: [
      {
        title: "Map full supply chain",
        description:
          "Document end-to-end supply chain: ingredient suppliers → co-packer → warehouse → fulfillment channels, with lead times at each step.",
        priority: "critical",
        estimated_hours: 4,
      },
      {
        title: "Calculate safety stock levels",
        description:
          "Determine safety stock for each SKU based on lead times, demand variability, and desired service level (target 95%).",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Build supplier scorecard",
        description:
          "Track supplier performance: on-time delivery, quality, pricing, communication. Use {ingredient_suppliers} answer to identify backup suppliers for critical ingredients.",
        priority: "medium",
        estimated_hours: 2,
      },
      {
        title: "Tune safety stock for seasonality",
        description:
          "Adjust safety stock and reorder triggers using seasonal demand profile: {seasonal_demand}.",
        priority: "medium",
        estimated_hours: 2,
      },
    ],
    kpis: [
      "supplier_on_time_delivery_pct",
      "ingredient_cost_trend",
      "lead_time_reliability",
      "safety_stock_coverage_days",
      "freight_cost_per_unit",
    ],
  },

  executive: {
    description:
      "CEO/founder-level strategic oversight, investor relations, and company-wide coordination.",
    baseline: [
      "Weekly/monthly executive dashboard",
      "Board meeting preparation",
      "Investor reporting",
      "Strategic planning and OKRs",
      "Cross-department coordination",
      "Risk management",
      "Legal and compliance overview",
      "Hiring and team planning",
      "Brand strategy",
      "Competitive intelligence",
    ],
    questions: [
      {
        key: "reporting_cadence",
        q: "How often do you review company metrics? (Daily, weekly, monthly?)",
        default: "weekly",
      },
      {
        key: "investors",
        q: "Do you have investors requiring reports? What frequency?",
      },
      {
        key: "okrs",
        q: "Do you use OKRs or another goal-setting framework?",
      },
      {
        key: "biggest_risk",
        q: "What's the biggest business risk right now?",
      },
      {
        key: "hiring_plans",
        q: "Any hiring planned in next 3-6 months?",
      },
    ],
    taskTemplate: [
      {
        title: "Build executive dashboard",
        description:
          "Create {reporting_cadence} executive dashboard: revenue (by channel), cash position, inventory status, pipeline value, key blockers, upcoming milestones.",
        priority: "critical",
        estimated_hours: 4,
      },
      {
        title: "Define company OKRs",
        description:
          "Set quarterly OKRs for each department with measurable key results. Track progress weekly.",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Create investor update template",
        description:
          "Monthly investor update: highlights, financials, metrics, asks. Keep it to 1 page.",
        priority: "medium",
        estimated_hours: 2,
      },
      {
        title: "Mitigate current top company risk",
        description:
          "Create and assign a mitigation plan for top stated risk: {biggest_risk}. Include owner and weekly checkpoint.",
        priority: "high",
        estimated_hours: 2,
      },
    ],
    kpis: [
      "total_revenue_monthly",
      "cash_runway_months",
      "burn_rate",
      "team_size",
      "okr_completion_rate",
      "customer_count_growth",
    ],
  },

  legal: {
    description:
      "Legal, risk management, corporate governance, contracts, IP protection, and FDA regulatory compliance for a CPG gummy company.",
    baseline: [
      "Contract templates (vendor, distributor, co-packer, employment)",
      "Intellectual property protection (trademarks, trade secrets)",
      "FDA food labeling compliance",
      "State-by-state food regulations",
      "Insurance coverage (product liability, general, D&O)",
      "Corporate governance documents",
      "Terms of service and privacy policy",
      "HACCP and food safety regulatory compliance",
    ],
    questions: [
      { key: "entity_type", q: "Current entity structure? (LLC, S-Corp, C-Corp)", options: ["LLC", "S-Corp", "C-Corp"] },
      { key: "trademarks", q: "Are trademarks filed for brand name and logo?" },
      { key: "insurance", q: "Current insurance coverage? (Product liability, general liability)" },
      { key: "fda_compliance", q: "Are labels FDA-compliant with Supplement Facts / Nutrition Facts?" },
    ],
    taskTemplate: [
      { title: "Audit contract templates", description: "Review and standardize vendor, distributor, co-packer, and partnership contract templates.", priority: "critical", estimated_hours: 4 },
      { title: "Verify FDA label compliance", description: "Ensure all product labels meet FDA requirements for food/supplement labeling.", priority: "critical", estimated_hours: 3 },
      { title: "File trademark registrations", description: "File trademarks for brand name, logo, and key product names if not already registered.", priority: "high", estimated_hours: 2 },
      { title: "Review insurance coverage", description: "Audit product liability, general liability, and D&O insurance policies for adequacy.", priority: "high", estimated_hours: 2 },
    ],
    kpis: ["open_legal_issues", "contract_turnaround_days", "compliance_audit_score", "insurance_coverage_adequacy"],
  },

  people: {
    description:
      "AI systems administration, agent performance optimization, workforce automation, and AI training. Manages AI agents, NOT human employees.",
    baseline: [
      "AI agent inventory and capability mapping",
      "Agent performance monitoring and SLAs",
      "Automated workflow design and optimization",
      "AI model cost tracking and optimization",
      "Agent deployment and versioning",
      "Capability gap analysis",
      "AI safety and guardrail management",
      "Cross-agent orchestration and scheduling",
    ],
    questions: [
      { key: "agent_count", q: "How many AI agents are currently deployed? (We have 80+ registered)", default: "80+" },
      { key: "performance_tracking", q: "How is agent performance tracked? (Logs, dashboards, manual review?)" },
      { key: "cost_per_agent", q: "Do you track cost per agent or per engine?" },
      { key: "capability_gaps", q: "What tasks are agents NOT handling well?" },
    ],
    taskTemplate: [
      { title: "Build AI agent inventory", description: "Catalog all deployed AI agents with capabilities, costs, schedules, and performance metrics.", priority: "critical", estimated_hours: 4 },
      { title: "Establish agent SLAs", description: "Define success/failure criteria and response time targets for each agent type.", priority: "high", estimated_hours: 3 },
      { title: "Create agent performance dashboard", description: "Build monitoring for agent run success rates, costs, and output quality.", priority: "high", estimated_hours: 4 },
      { title: "Identify automation gaps", description: "Analyze which manual processes could be automated with new agents.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["agent_success_rate_pct", "ai_cost_per_task", "automation_coverage_pct", "agent_uptime_pct", "capability_gap_count"],
  },

  product: {
    description:
      "R&D, new product development, ingredient standards, packaging innovation, and product portfolio strategy for gummy candy.",
    baseline: [
      "Product development pipeline",
      "Ingredient sourcing specifications",
      "Flavor/formulation R&D process",
      "Packaging design and engineering",
      "SKU rationalization and portfolio management",
      "Dietary variant roadmap (vegan, sugar-free, organic)",
      "Competitive product benchmarking",
      "Product cost modeling",
    ],
    questions: [
      { key: "current_skus", q: "How many active SKUs? Any planned launches?" },
      { key: "dietary_variants", q: "Which dietary variants are planned? (Vegan, sugar-free, organic, keto?)" },
      { key: "rd_process", q: "How are new products developed? (In-house, co-packer R&D, external lab?)" },
      { key: "packaging_type", q: "Current packaging format? (Stand-up pouch, jar, bag?)" },
    ],
    taskTemplate: [
      { title: "Map product development pipeline", description: "Document all products in development from concept through launch with stage gates.", priority: "critical", estimated_hours: 3 },
      { title: "Create ingredient specification docs", description: "Standardize ingredient specs for each product with supplier alternatives.", priority: "high", estimated_hours: 4 },
      { title: "Build SKU performance scorecard", description: "Track revenue, margin, velocity, and growth for each SKU to inform portfolio decisions.", priority: "high", estimated_hours: 3 },
      { title: "Design packaging innovation roadmap", description: "Plan packaging improvements for cost, sustainability, and shelf appeal.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["new_product_launch_count", "rd_to_launch_time_weeks", "sku_count_active", "product_margin_by_sku", "innovation_pipeline_value"],
  },

  quality: {
    description:
      "Quality assurance, food safety, HACCP compliance, regulatory compliance, and lab/testing oversight for CPG gummy products.",
    baseline: [
      "Quality control inspection protocols",
      "HACCP plan documentation",
      "Third-party lab testing schedule",
      "Retention sample management",
      "Supplier quality audits",
      "Complaint tracking and CAPA",
      "Shelf-life testing program",
      "Allergen management protocol",
    ],
    questions: [
      { key: "haccp", q: "Is there a documented HACCP plan?" },
      { key: "lab_testing", q: "What third-party labs are used? Testing frequency?" },
      { key: "complaints", q: "How are customer quality complaints tracked?" },
      { key: "certifications", q: "Current certifications? (GMP, organic, kosher, NSF?)" },
    ],
    taskTemplate: [
      { title: "Document HACCP plan", description: "Create or update Hazard Analysis Critical Control Points plan for all product lines.", priority: "critical", estimated_hours: 6 },
      { title: "Establish lab testing schedule", description: "Set recurring third-party testing for microbial, heavy metals, potency, and shelf stability.", priority: "critical", estimated_hours: 3 },
      { title: "Build complaint tracking system", description: "Implement CAPA (Corrective and Preventive Action) tracking for quality complaints.", priority: "high", estimated_hours: 3 },
      { title: "Create supplier audit program", description: "Define and schedule quality audits for ingredient suppliers and co-packer.", priority: "high", estimated_hours: 2 },
    ],
    kpis: ["quality_complaint_rate", "lab_test_pass_rate", "capa_closure_time_days", "supplier_audit_score", "shelf_life_compliance_pct"],
  },

  trade_marketing: {
    description:
      "In-store promotions, retailer marketing programs, category insights, planogram strategy for CPG gummy brand in retail.",
    baseline: [
      "Trade promotion calendar",
      "Retailer co-op marketing programs",
      "Category management presentations",
      "Planogram and shelf placement strategy",
      "In-store demo program",
      "Trade spend tracking and ROI",
      "Retailer scorecard",
      "Competitive shelf analysis",
    ],
    questions: [
      { key: "current_retailers", q: "Which retailers currently carry products?" },
      { key: "trade_spend", q: "Annual trade marketing budget?" },
      { key: "demo_program", q: "Do you run in-store demos? How frequently?" },
      { key: "planogram", q: "Are products in retailer planograms or off-shelf?" },
    ],
    taskTemplate: [
      { title: "Build trade promotion calendar", description: "Plan quarterly trade promotions aligned with retailer resets and seasonal events.", priority: "critical", estimated_hours: 3 },
      { title: "Create category management deck", description: "Build data-driven pitch showing gummy category trends and brand positioning.", priority: "high", estimated_hours: 4 },
      { title: "Track trade spend ROI", description: "Implement tracking for trade promotion lift, incremental revenue, and cost per incremental unit.", priority: "high", estimated_hours: 3 },
      { title: "Design in-store demo playbook", description: "Standardize demo execution: staffing, materials, sampling, data capture.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["trade_spend_roi", "retailer_count", "shelf_velocity_per_store", "demo_conversion_rate", "category_share_pct"],
  },

  marketing: {
    description:
      "Brand marketing, growth/performance marketing, content creation, social media, influencer partnerships for a DTC gummy brand.",
    baseline: [
      "Brand identity and style guide",
      "Growth marketing strategy (paid + organic)",
      "Content calendar and production workflow",
      "Social media management",
      "Influencer and partnership program",
      "Marketing attribution and analytics",
      "Community building strategy",
      "PR and media outreach",
    ],
    questions: [
      { key: "brand_guidelines", q: "Do you have a brand style guide? (Colors, voice, typography)" },
      { key: "paid_channels", q: "Active paid channels? (Meta, Google, TikTok, Amazon PPC?)" },
      { key: "content_cadence", q: "Content publishing frequency? (Blog, social, email?)" },
      { key: "influencer_strategy", q: "Active influencer partnerships? Budget allocated?" },
    ],
    taskTemplate: [
      { title: "Audit brand identity", description: "Review and formalize brand guidelines: voice, visual identity, messaging pillars.", priority: "critical", estimated_hours: 4 },
      { title: "Build content calendar", description: "Plan 90-day content calendar across blog, social, email, and video.", priority: "high", estimated_hours: 3 },
      { title: "Launch influencer program", description: "Identify, recruit, and manage micro-influencers for product seeding and content.", priority: "high", estimated_hours: 4 },
      { title: "Set up marketing attribution", description: "Implement UTM tracking, GA4 conversions, and channel-level ROAS measurement.", priority: "high", estimated_hours: 3 },
    ],
    kpis: ["roas_by_channel", "social_engagement_rate", "email_open_rate", "content_pieces_published", "brand_awareness_index"],
  },

  ecommerce: {
    description:
      "Shopify store management, CRO, email/SMS marketing, subscription programs, and customer data for DTC gummy sales.",
    baseline: [
      "Shopify store optimization",
      "Conversion rate optimization (CRO)",
      "Email marketing flows (welcome, abandoned cart, post-purchase)",
      "SMS marketing program",
      "Subscription and loyalty programs",
      "Customer segmentation and personalization",
      "A/B testing framework",
      "Site speed and performance",
    ],
    questions: [
      { key: "email_platform", q: "Email/SMS platform? (Klaviyo, Mailchimp, Postscript?)", default: "Klaviyo" },
      { key: "subscription", q: "Is a subscription program active or planned?" },
      { key: "avg_order_value", q: "Current average order value?" },
      { key: "email_list_size", q: "Email subscriber count?" },
    ],
    taskTemplate: [
      { title: "Optimize checkout flow", description: "Audit and optimize Shopify checkout: reduce friction, add trust signals, test upsells.", priority: "critical", estimated_hours: 4 },
      { title: "Build email automation flows", description: "Create welcome series, abandoned cart, post-purchase, and win-back email flows.", priority: "critical", estimated_hours: 6 },
      { title: "Launch subscription program", description: "Implement subscribe-and-save with flexible frequency and discount incentives.", priority: "high", estimated_hours: 4 },
      { title: "Set up A/B testing", description: "Implement systematic testing for product pages, pricing, and checkout.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["dtc_conversion_rate", "avg_order_value", "email_revenue_pct", "subscription_rate", "cart_abandonment_rate", "customer_ltv"],
  },

  amazon: {
    description:
      "Amazon Seller Central account management, PPC advertising (3 active Sponsored Products campaigns + 1 paused), listing optimization, FBA logistics, reviews, and brand protection. ASIN: B0G1JK92TJ, Seller ID: A16G27VYDSSEGO.",
    baseline: [
      "Amazon account health monitoring",
      "PPC campaign management — 3 active campaigns: USG-Auto-Discovery (auto, $40/day), USG-Manual-Exact (exact keywords, $15/day), USG-Product-Targeting (competitor ASINs + category, $25/day). USG-Manual-Phrase paused. Combined $80/day (~$2,400/mo).",
      "PPC weekly optimization: search term mining from auto→exact, negative keyword additions, bid adjustments, budget reallocation",
      "Listing optimization (titles, bullets, A+ content, backend keywords)",
      "FBA inventory management and replenishment",
      "Review generation and reputation management",
      "Brand Registry and brand protection",
      "Competitor monitoring on Amazon (Black Forest, Haribo, NERDS, YumEarth tracked in product targeting)",
      "Amazon advertising reporting — ACoS target <30%, TACoS target <15%",
    ],
    questions: [
      { key: "seller_type", q: "Seller Central or Vendor Central?", default: "Seller Central" },
      { key: "fba_or_fbm", q: "Fulfillment method? (FBA, FBM, or hybrid?)", default: "FBA" },
      { key: "ppc_budget", q: "Monthly Amazon PPC budget?", default: "$6K Mar, $5K Apr, $4K May (pro-forma)" },
      { key: "asin_count", q: "How many ASINs are listed?", default: "1 (B0G1JK92TJ — Dye Free Gummy Bears)" },
      { key: "brand_registry", q: "Enrolled in Amazon Brand Registry?", default: "yes" },
    ],
    taskTemplate: [
      { title: "Weekly PPC search term mining", description: "Pull search term report from USG-Auto-Discovery. Graduate 3+ click converters to USG-Manual-Exact. Add 10+ click non-converters as negative keywords.", priority: "critical", estimated_hours: 1 },
      { title: "Weekly bid optimization", description: "Adjust bids on USG-Manual-Exact keywords: reduce 10-15% if ACoS >35%, increase 10-20% if ACoS <20% with low impressions. Review product targeting bids on USG-Product-Targeting.", priority: "critical", estimated_hours: 1 },
      { title: "Optimize Amazon listings", description: "Rewrite titles, bullet points, and A+ content for all ASINs using keyword research.", priority: "critical", estimated_hours: 6 },
      { title: "Monthly PPC budget review", description: "Compare actual spend to pro-forma allocation ($6K Mar, $5K Apr, $4K May). Reallocate between campaigns based on ROAS performance.", priority: "high", estimated_hours: 1 },
      { title: "Set up FBA replenishment alerts", description: "Create inventory monitoring with reorder triggers based on velocity and lead time.", priority: "high", estimated_hours: 2 },
      { title: "Build review generation strategy", description: "Implement Amazon Vine, Request a Review automation, and insert card program.", priority: "high", estimated_hours: 2 },
      { title: "Competitor ASIN monitoring", description: "Check USG-Product-Targeting performance by competitor ASIN. Add new competitor ASINs, pause non-converters after 2 weeks.", priority: "medium", estimated_hours: 1 },
    ],
    kpis: ["amazon_revenue_monthly", "acos_pct", "tacos_pct", "ppc_daily_spend", "ppc_roas", "organic_rank_top_keywords", "review_count", "review_rating_avg", "fba_inventory_health"],
  },

  customer_experience: {
    description:
      "Customer service, returns processing, voice of customer programs, and NPS tracking for gummy brand.",
    baseline: [
      "Customer support workflow (email, chat, social)",
      "Returns and refund policy and processing",
      "Voice of customer feedback collection",
      "NPS and CSAT tracking",
      "FAQ and help center content",
      "Complaint resolution SLAs",
      "Customer feedback loop to product team",
    ],
    questions: [
      { key: "support_channels", q: "Active support channels? (Email, chat, phone, social?)" },
      { key: "support_volume", q: "Monthly support ticket volume?" },
      { key: "nps", q: "Do you track NPS currently? What's the score?" },
      { key: "return_rate", q: "What's the current return/refund rate?" },
    ],
    taskTemplate: [
      { title: "Create support playbook", description: "Document response templates, escalation paths, and resolution guidelines.", priority: "critical", estimated_hours: 4 },
      { title: "Implement NPS tracking", description: "Set up post-purchase NPS surveys and track score over time.", priority: "high", estimated_hours: 2 },
      { title: "Build feedback-to-product loop", description: "Create process to funnel customer feedback into product and quality improvements.", priority: "high", estimated_hours: 2 },
      { title: "Optimize returns process", description: "Streamline returns/refunds with clear policy, fast processing, and root cause tracking.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["nps_score", "csat_score", "avg_response_time_hours", "first_contact_resolution_pct", "return_rate_pct"],
  },

  data_analytics: {
    description:
      "Business intelligence, dashboards, advanced analytics, data engineering, and consumer insights for CPG operations.",
    baseline: [
      "BI dashboard suite (revenue, inventory, marketing, operations)",
      "Data pipeline architecture (Shopify, Amazon, GA4, Supabase)",
      "Customer segmentation and cohort analysis",
      "Demand forecasting models",
      "A/B testing infrastructure",
      "Data warehouse and ETL processes",
      "Reporting cadence and distribution",
    ],
    questions: [
      { key: "data_sources", q: "Primary data sources? (Shopify, Amazon, GA4, Notion, Supabase)" },
      { key: "bi_tool", q: "BI/dashboard tool? (Custom ops dashboard, Looker, Metabase?)", default: "Custom ops dashboard" },
      { key: "data_literacy", q: "Team data literacy level? Who consumes dashboards?" },
      { key: "forecasting", q: "Any demand forecasting in place?" },
    ],
    taskTemplate: [
      { title: "Audit data pipeline health", description: "Verify all data sources (Shopify, Amazon, GA4) are flowing correctly and on schedule.", priority: "critical", estimated_hours: 3 },
      { title: "Build executive KPI dashboard", description: "Create unified dashboard with revenue, inventory, marketing, and operational KPIs.", priority: "critical", estimated_hours: 6 },
      { title: "Implement customer cohort analysis", description: "Build cohort analysis for DTC customers: acquisition, retention, LTV by channel.", priority: "high", estimated_hours: 4 },
      { title: "Create demand forecast model", description: "Build statistical demand forecasting using historical sales, seasonality, and trends.", priority: "high", estimated_hours: 4 },
    ],
    kpis: ["dashboard_adoption_rate", "data_freshness_hours", "forecast_accuracy_pct", "report_delivery_on_time_pct"],
  },

  it: {
    description:
      "Engineering, cloud infrastructure, cybersecurity, and vendor tech management for the USA Gummies tech stack.",
    baseline: [
      "Application architecture (Next.js, Vercel, Supabase)",
      "API integrations (Shopify, Amazon SP-API, GA4, Notion)",
      "Cloud infrastructure management (Vercel, Supabase, Upstash)",
      "Security and access control",
      "Deployment and CI/CD pipeline",
      "SaaS vendor management",
      "Monitoring and alerting",
      "Disaster recovery and backups",
    ],
    questions: [
      { key: "hosting", q: "Hosting platform? (Vercel Hobby plan confirmed)", default: "Vercel Hobby" },
      { key: "security", q: "Security measures in place? (2FA, access controls, audit logs)" },
      { key: "monitoring", q: "Application monitoring tools? (Vercel analytics, custom?)" },
      { key: "backup", q: "Database backup strategy?" },
    ],
    taskTemplate: [
      { title: "Security audit", description: "Review access controls, API key management, env var security, and auth flows.", priority: "critical", estimated_hours: 4 },
      { title: "Document tech stack architecture", description: "Create architecture diagram covering all services, APIs, data flows, and integrations.", priority: "high", estimated_hours: 3 },
      { title: "Set up monitoring and alerting", description: "Implement uptime monitoring, error tracking, and performance alerting.", priority: "high", estimated_hours: 3 },
      { title: "Create disaster recovery plan", description: "Document backup procedures, recovery steps, and RTO/RPO targets.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["uptime_pct", "deploy_success_rate", "security_incidents", "api_error_rate", "page_load_time_ms"],
  },

  retail_execution: {
    description:
      "Field sales coverage, merchandising audits, store-level data capture, and in-store demos for retail gummy placement.",
    baseline: [
      "Field rep coverage map",
      "Merchandising audit checklist",
      "Store-level sales data collection",
      "In-store demo execution playbook",
      "Retail compliance tracking",
      "Competitor shelf audit",
      "Route planning and territory management",
    ],
    questions: [
      { key: "field_reps", q: "Any field sales reps or brokers? How many?" },
      { key: "retail_accounts", q: "How many retail locations carry the product?" },
      { key: "audit_frequency", q: "How often are store audits conducted?" },
      { key: "demo_program", q: "Active in-store sampling/demo program?" },
    ],
    taskTemplate: [
      { title: "Build store coverage map", description: "Map all retail locations carrying product with field rep assignments and visit frequency.", priority: "critical", estimated_hours: 3 },
      { title: "Create merchandising audit checklist", description: "Standardize what reps check: shelf placement, pricing, signage, out-of-stocks, competitor activity.", priority: "high", estimated_hours: 2 },
      { title: "Design demo execution playbook", description: "Document setup, staffing, sampling, engagement, and data capture for in-store demos.", priority: "high", estimated_hours: 3 },
      { title: "Implement store-level reporting", description: "Create mobile-friendly form for field reps to capture visit data and photos.", priority: "medium", estimated_hours: 3 },
    ],
    kpis: ["stores_visited_per_week", "out_of_stock_rate", "demo_roi", "shelf_compliance_pct", "field_rep_productivity"],
  },

  corporate_affairs: {
    description:
      "Public relations, government affairs, CSR, and internal communications for USA Gummies brand.",
    baseline: [
      "Media relations and press kit",
      "Government and regulatory affairs tracking",
      "Corporate social responsibility programs",
      "Internal communications cadence",
      "Crisis communications plan",
      "Community engagement strategy",
    ],
    questions: [
      { key: "pr_agency", q: "Do you work with a PR agency or handle in-house?" },
      { key: "media_coverage", q: "Any media coverage to date? Publications?" },
      { key: "csr", q: "Any CSR or community initiatives planned?" },
      { key: "crisis_plan", q: "Is there a crisis communications plan?" },
    ],
    taskTemplate: [
      { title: "Build press kit", description: "Create media kit with brand story, founder bio, product images, fact sheet, and press releases.", priority: "high", estimated_hours: 4 },
      { title: "Create crisis communications plan", description: "Document response protocols for product recalls, negative press, social media crises.", priority: "high", estimated_hours: 3 },
      { title: "Launch CSR initiative", description: "Design a community or sustainability program aligned with brand values.", priority: "medium", estimated_hours: 2 },
      { title: "Set up media monitoring", description: "Track brand mentions, industry news, and competitor press coverage.", priority: "medium", estimated_hours: 1 },
    ],
    kpis: ["media_mentions_monthly", "press_coverage_reach", "brand_sentiment_score", "csr_impact_metrics"],
  },

  brand_studio: {
    description:
      "In-house creative agency, content production, brand partnerships, and media distribution for gummy brand.",
    baseline: [
      "Creative asset library (photo, video, design)",
      "Content production workflow",
      "Brand partnership pipeline",
      "Media distribution strategy",
      "Creative brief process",
      "Asset management and DAM",
      "Brand consistency guidelines",
    ],
    questions: [
      { key: "creative_tools", q: "Creative tools in use? (Canva, Adobe, Figma?)" },
      { key: "content_types", q: "Primary content types? (Product photo, lifestyle, video, UGC?)" },
      { key: "partnerships", q: "Any active brand partnerships or collaborations?" },
      { key: "distribution", q: "Content distribution channels? (Social, blog, email, PR?)" },
    ],
    taskTemplate: [
      { title: "Build creative asset library", description: "Organize all brand assets: product shots, lifestyle images, videos, logos, templates.", priority: "critical", estimated_hours: 4 },
      { title: "Create content production SOP", description: "Document workflow from brief to publish: concepting, production, review, distribution.", priority: "high", estimated_hours: 3 },
      { title: "Launch brand partnership program", description: "Identify and pitch complementary brands for co-marketing and collaboration.", priority: "high", estimated_hours: 4 },
      { title: "Set up DAM system", description: "Implement digital asset management for organized access to all creative files.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["content_pieces_produced", "asset_utilization_rate", "partnership_revenue", "brand_consistency_score"],
  },

  research_lab: {
    description:
      "Consumer testing, product sensory evaluation, market research, and competitive analysis for gummy products.",
    baseline: [
      "Consumer testing panels",
      "Sensory evaluation protocols",
      "Market research studies",
      "Competitive product analysis",
      "Trend monitoring and forecasting",
      "Concept testing framework",
      "Consumer insight reports",
    ],
    questions: [
      { key: "testing_panels", q: "Do you have consumer testing panels set up?" },
      { key: "sensory", q: "Is there a sensory evaluation process for new products?" },
      { key: "competitive_intel", q: "How do you track competitors? (Manual, tools, reports?)" },
      { key: "research_budget", q: "Annual market research budget?" },
    ],
    taskTemplate: [
      { title: "Build consumer testing panel", description: "Recruit a panel of target consumers for product testing and feedback.", priority: "high", estimated_hours: 4 },
      { title: "Create sensory evaluation protocol", description: "Standardize taste test methodology: blind testing, scoring rubric, documentation.", priority: "high", estimated_hours: 3 },
      { title: "Launch competitive analysis program", description: "Set up systematic tracking of competitor products, pricing, and marketing.", priority: "high", estimated_hours: 3 },
      { title: "Design concept testing framework", description: "Create process to test new product concepts with consumers before development.", priority: "medium", estimated_hours: 2 },
    ],
    kpis: ["consumer_tests_conducted", "concept_test_success_rate", "competitive_reports_published", "insight_action_rate"],
  },
};

/**
 * Get playbook for a department from hardcoded registry, matching loosely on name.
 */
export function getPlaybook(
  department: string,
): DepartmentPlaybook | null {
  const key = department.toLowerCase().replace(/[\s-]+/g, "_");
  if (key in DEPARTMENT_PLAYBOOKS) {
    return DEPARTMENT_PLAYBOOKS[key];
  }
  // Fuzzy match
  for (const [k, v] of Object.entries(DEPARTMENT_PLAYBOOKS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

export type ActivePlaybookSummary = {
  department: string;
  name: string;
  triggers: string[];
  steps: string[];
};

const PLAYBOOK_TRIGGERS: Record<string, string[]> = {
  finance: ["finance", "cash flow", "margin", "cogs", "burn rate", "runway", "accounting", "bookkeeping"],
  operations: ["operations", "production", "manufacturing", "co-packer", "packaging"],
  sales_and_growth: ["sales", "pipeline", "wholesale", "pricing", "distributor", "b2b"],
  supply_chain: ["supply chain", "inventory", "supplier", "lead time", "stockout", "procurement", "logistics"],
  executive: ["strategy", "investor", "risk", "okr", "board", "leadership", "ceo"],
  legal: ["legal", "contract", "trademark", "fda", "compliance", "insurance", "ip"],
  people: ["ai agent", "agent performance", "workforce automation", "ai training", "agent deployment"],
  product: ["product", "r&d", "flavor", "formulation", "sku", "new product", "packaging innovation"],
  quality: ["quality", "food safety", "haccp", "lab testing", "qa", "qc", "shelf life"],
  trade_marketing: ["trade marketing", "planogram", "shelf", "in-store", "category management", "merchandising"],
  marketing: ["marketing", "brand", "content", "social media", "influencer", "pr", "growth marketing"],
  ecommerce: ["ecommerce", "shopify", "dtc", "conversion rate", "email marketing", "subscription", "loyalty"],
  amazon: ["amazon", "asin", "ppc", "fba", "seller central", "a+ content", "brand registry"],
  customer_experience: ["customer service", "support", "nps", "csat", "returns", "complaints", "feedback"],
  data_analytics: ["analytics", "dashboard", "bi", "data", "forecast", "segmentation", "cohort"],
  it: ["engineering", "infrastructure", "cybersecurity", "devops", "tech stack", "api", "deployment"],
  retail_execution: ["retail", "field sales", "merchandising", "store audit", "demo", "in-store"],
  corporate_affairs: ["public relations", "pr", "government affairs", "csr", "internal comms", "crisis"],
  brand_studio: ["creative", "content production", "brand partnership", "media", "design", "photography"],
  research_lab: ["consumer testing", "sensory", "market research", "competitive analysis", "focus group"],
};

function toTitleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

/**
 * Returns simplified active playbooks suitable for system prompt injection.
 * Uses the hardcoded registry as source of truth.
 */
export function getActivePlaybooks(): ActivePlaybookSummary[] {
  return Object.entries(DEPARTMENT_PLAYBOOKS).map(([department, playbook]) => {
    const topQuestions = playbook.questions.slice(0, 3).map((q) => q.q);
    const topTasks = playbook.taskTemplate.slice(0, 3).map((task) => task.title);
    const topKpis = playbook.kpis.slice(0, 3).join(", ");

    return {
      department,
      name: `${toTitleCase(department)} Playbook`,
      triggers: PLAYBOOK_TRIGGERS[department] || [department],
      steps: [
        `Clarify objective and timeframe for ${toTitleCase(department)}.`,
        `Collect critical context: ${topQuestions.join(" | ")}`,
        `Verify baseline capabilities: ${playbook.baseline.slice(0, 3).join(", ")}.`,
        `Prioritize execution tasks: ${topTasks.join(" | ")}.`,
        `Track progress with KPIs: ${topKpis}.`,
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// DB-backed Playbook Evolution
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Load a playbook from the DB (abra_departments.playbook_overrides JSONB).
 * Returns null if not found or DB unavailable.
 */
export async function getPlaybookFromDB(
  department: string,
): Promise<DepartmentPlaybook | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  try {
    const headers = new Headers({
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    });

    const res = await fetch(
      `${env.baseUrl}/rest/v1/abra_departments?name=eq.${department}&select=playbook_overrides`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      playbook_overrides: DepartmentPlaybook | null;
    }>;

    return rows?.[0]?.playbook_overrides || null;
  } catch {
    return null;
  }
}

/**
 * Save an evolved playbook back to the DB for a department.
 * This allows playbooks to evolve as Abra learns what works.
 */
export async function savePlaybookToDB(
  department: string,
  playbook: DepartmentPlaybook,
): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env) return false;

  try {
    const headers = new Headers({
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    });

    const res = await fetch(
      `${env.baseUrl}/rest/v1/abra_departments?name=eq.${department}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ playbook_overrides: playbook }),
        signal: AbortSignal.timeout(5000),
      },
    );

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get playbook with DB-first, hardcoded fallback strategy.
 * Merges DB overrides on top of hardcoded baseline if both exist.
 */
export async function getPlaybookWithFallback(
  department: string,
): Promise<DepartmentPlaybook | null> {
  const hardcoded = getPlaybook(department);
  const dbPlaybook = await getPlaybookFromDB(department);

  if (dbPlaybook && hardcoded) {
    // Merge: DB overrides take precedence, hardcoded fills gaps
    return {
      description: dbPlaybook.description || hardcoded.description,
      baseline: dbPlaybook.baseline.length > 0 ? dbPlaybook.baseline : hardcoded.baseline,
      questions: dbPlaybook.questions.length > 0 ? dbPlaybook.questions : hardcoded.questions,
      taskTemplate: dbPlaybook.taskTemplate.length > 0 ? dbPlaybook.taskTemplate : hardcoded.taskTemplate,
      kpis: dbPlaybook.kpis.length > 0 ? dbPlaybook.kpis : hardcoded.kpis,
    };
  }

  return dbPlaybook || hardcoded;
}

/**
 * Extract just the department name from a user goal like "get finance under control"
 */
/**
 * Operating Pillars — maps departments to strategic pillars
 */
export const OPERATING_PILLARS: Record<string, { name: string; departments: string[] }> = {
  build_the_product: {
    name: "Build the Product",
    departments: ["product", "quality", "operations", "research_lab"],
  },
  move_the_product: {
    name: "Move the Product",
    departments: ["supply_chain", "retail_execution"],
  },
  sell_the_product: {
    name: "Sell the Product",
    departments: ["sales_and_growth", "trade_marketing", "amazon"],
  },
  grow_the_brand: {
    name: "Grow the Brand",
    departments: ["marketing", "ecommerce", "brand_studio", "customer_experience"],
  },
  control_the_business: {
    name: "Control the Business",
    departments: ["finance", "legal", "data_analytics", "it", "corporate_affairs", "executive", "people"],
  },
};

/**
 * Extract department name from user text. Checks more specific terms first
 * to avoid false positives (e.g. "amazon" before "sales").
 */
export function detectDepartment(text: string): string | null {
  const lower = text.toLowerCase();

  // Ordered from most specific to least — prevents "marketing" matching before "trade_marketing"
  const departmentKeywords: [string, string[]][] = [
    ["trade_marketing", ["trade marketing", "planogram", "category management", "in-store promotion", "retailer marketing"]],
    ["amazon", ["amazon", "seller central", "asin", "fba", "fbm", "brand registry", "a+ content"]],
    ["ecommerce", ["ecommerce", "e-commerce", "shopify store", "dtc", "direct to consumer", "conversion rate optim", "email marketing", "subscription"]],
    ["customer_experience", ["customer service", "customer support", "nps", "csat", "voice of customer", "customer experience"]],
    ["retail_execution", ["field sales", "merchandising audit", "store audit", "in-store demo", "retail execution"]],
    ["brand_studio", ["brand studio", "creative agency", "content production", "brand partnership", "media company"]],
    ["research_lab", ["consumer testing", "sensory evaluation", "focus group", "market research", "research lab"]],
    ["corporate_affairs", ["public relations", "government affairs", "csr", "corporate social", "crisis communication", "corporate affairs"]],
    ["data_analytics", ["business intelligence", "analytics", "data engineering", "consumer insights", "data analytics", "dashboard"]],
    ["people", ["ai agent", "agent performance", "workforce automation", "ai training", "ai systems admin"]],
    ["quality", ["quality assurance", "food safety", "haccp", "lab testing", "qc ", "qa ", "quality control"]],
    ["product", ["product development", "r&d", "new product", "ingredient standard", "packaging innovation", "product portfolio", "sku rationalization"]],
    ["legal", ["legal", "contract", "trademark", "intellectual property", "fda compliance", "insurance", "corporate governance"]],
    ["it", ["engineering", "infrastructure", "cybersecurity", "tech stack", "deployment", "cloud ops", "information technology"]],
    ["marketing", ["marketing", "brand market", "growth market", "influencer", "social media", "content strategy"]],
    ["finance", ["finance", "financial", "accounting", "bookkeeping", "quickbooks", "accounts payable", "accounts receivable", "budg", "cash flow", "cogs"]],
    ["operations", ["operations", "ops", "production", "manufacturing", "co-pack", "fulfillment", "shipping"]],
    ["sales_and_growth", ["sales", "growth", "revenue", "pipeline", "b2b", "wholesale"]],
    ["supply_chain", ["supply chain", "sourcing", "procurement", "inventory", "supplier", "vendor", "logistics"]],
    ["executive", ["executive", "strategy", "strategic", "okr", "investor", "board", "leadership", "ceo"]],
  ];

  for (const [dept, keywords] of departmentKeywords) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return dept;
    }
  }
  return null;
}
