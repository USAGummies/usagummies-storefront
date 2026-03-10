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
          "Configure separate revenue tracking for DTC (Shopify), Amazon (marketplace fees, FBA fees), Wholesale (terms, returns), and Faire (commission structure).",
        priority: "high",
        estimated_hours: 3,
      },
      {
        title: "Configure sales tax compliance",
        description:
          "Set up sales tax collection for nexus states, configure automated remittance if possible, document exemption certificates for wholesale.",
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
          "Rolling production schedule based on sales velocity, inventory levels, and seasonal demand patterns.",
        priority: "high",
        estimated_hours: 3,
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
        title: "Create wholesale rate card",
        description:
          "Develop tiered wholesale pricing: case pricing, pallet pricing, distributor pricing. Include minimum order quantities and payment terms.",
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
          "Track supplier performance: on-time delivery, quality, pricing, communication. Identify backup suppliers for critical ingredients.",
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
          "Create weekly dashboard: revenue (by channel), cash position, inventory status, pipeline value, key blockers, upcoming milestones.",
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
};

/**
 * Get playbook for a department, matching loosely on name.
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

/**
 * Extract just the department name from a user goal like "get finance under control"
 */
export function detectDepartment(text: string): string | null {
  const lower = text.toLowerCase();
  const departmentKeywords: Record<string, string[]> = {
    finance: ["finance", "financial", "accounting", "bookkeeping", "quickbooks", "accounts payable", "accounts receivable", "budg"],
    operations: ["operations", "ops", "production", "manufacturing", "shipping", "fulfillment"],
    sales_and_growth: ["sales", "growth", "revenue", "pipeline", "b2b", "wholesale", "dtc", "marketing"],
    supply_chain: ["supply chain", "sourcing", "procurement", "inventory", "supplier", "vendor", "logistics"],
    executive: ["executive", "strategy", "strategic", "okr", "investor", "board", "leadership"],
  };

  for (const [dept, keywords] of Object.entries(departmentKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return dept;
    }
  }
  return null;
}
