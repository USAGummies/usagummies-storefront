/**
 * Abra Department Router — Routes inbound signals to the right department
 * and maintains ongoing workstream awareness.
 *
 * Departments operate like a real company org chart:
 *   Finance/Accounting — books, AP/AR, reconciliation, tax, bookkeeper (Rene)
 *   Sales/Wholesale    — B2B, distributors, brokers, pricing, Walmart/retail
 *   Operations         — supply chain, production, co-packers, inventory, fulfillment
 *   Marketing          — SEO, social, content, DTC campaigns, ads
 *   Customer Support   — order issues, returns, customer emails
 *
 * When an email or task comes in, the coordinator classifies it by department,
 * then the department handler adds workstream context before the LLM drafts a response.
 */

// ---------------------------------------------------------------------------
// Department definitions
// ---------------------------------------------------------------------------

export type DepartmentId =
  | "finance"
  | "sales"
  | "operations"
  | "marketing"
  | "support"
  | "executive";

export interface Department {
  id: DepartmentId;
  name: string;
  description: string;
  /** Notion databases this department primarily works with */
  databases: string[];
  /** Ongoing workstreams — NOT one-off tasks. These persist across email threads. */
  workstreams: Workstream[];
  /** System prompt addition for LLM when handling this department's work */
  systemContext: string;
}

export interface Workstream {
  id: string;
  name: string;
  status: "active" | "paused" | "completed";
  description: string;
  /** Notion page or database ID where this workstream's artifacts live */
  notionHub?: string;
  /** Who owns this workstream */
  owner?: string;
}

// ---------------------------------------------------------------------------
// Department registry
// ---------------------------------------------------------------------------

export const DEPARTMENTS: Record<DepartmentId, Department> = {
  finance: {
    id: "finance",
    name: "Finance & Accounting",
    description:
      "Manages the company books, AP/AR, bank reconciliation, COGS tracking, " +
      "tax prep, and financial reporting. Works with bookkeeper Rene Gonzalez.",
    databases: [
      "cash_transactions",
      "kpis",
      "daily_performance",
    ],
    workstreams: [
      {
        id: "ws-books-build",
        name: "Books Build — Full Accounting Setup",
        status: "active",
        description:
          "Rene Gonzalez is building USA Gummies' books from scratch. This includes: " +
          "chart of accounts setup, historical transaction categorization, vendor/bill tracking, " +
          "bank reconciliation, COGS analysis, and monthly P&L statements. " +
          "ALL financial data requests from Rene are part of this workstream.",
        notionHub: "3264c0c42c2e81b7b2fac6c4b812a170",
        owner: "Rene Gonzalez",
      },
      {
        id: "ws-monthly-close",
        name: "Monthly Close Process",
        status: "active",
        description:
          "Recurring monthly close: reconcile bank transactions, categorize expenses, " +
          "prepare journal entries, generate P&L and balance sheet. " +
          "Monthly Close Checklist DB: 72dd43a214434a57b25fba87b51b00c0",
        notionHub: "72dd43a214434a57b25fba87b51b00c0",
      },
      {
        id: "ws-ap-tracking",
        name: "Accounts Payable Tracking",
        status: "active",
        description:
          "Track all vendor bills, payment terms, and payment status. " +
          "AP Tracker DB: c0adc90330694fcbba761fd5ce5d9802. " +
          "Key vendors: Albanese (ingredients), Powers Confections (co-packing), " +
          "Lowe Graham Jones (legal/IP), Pirate Ship (shipping).",
        notionHub: "c0adc90330694fcbba761fd5ce5d9802",
      },
    ],
    systemContext: `You are operating as USA Gummies' FINANCE & ACCOUNTING department.

NOTION ACCOUNTING SYSTEM (live databases under Bookkeeping Hub):
- Bookkeeping Hub: 3264c0c42c2e81b7b2fac6c4b812a170
- Chart of Accounts: e00f886dc4864a5b8c61248837226ac3 (26 accounts, 1000-6800)
- Accounts Payable Tracker: c0adc90330694fcbba761fd5ce5d9802
- Accounts Receivable Tracker: 707fad73b7cb431192a917e60a683476
- Monthly Close Checklist: 72dd43a214434a57b25fba87b51b00c0 (Jan 2025 - Mar 2026)
- Vendor Master List: 324df0dd36d4459a8aaa691c5d101806 (8 vendors)
- Cash Transactions: 6325d16870024b83876b9e591b3d2d9c

ACTIVE WORKSTREAMS:
1. BOOKS BUILD (Owner: Rene Gonzalez) — Rene is building our books from scratch.
   - ANY request from Rene for financial data is part of this workstream
   - Deliver data as Notion pages under the Bookkeeping Hub, NOT as email text
   - Include CSV export instructions: Notion > ••• menu > Export > Markdown & CSV
   - Never ask Rene clarifying questions — look up the data and deliver it
   - When Rene asks for vendor list → query Vendor Master List database
   - When Rene asks for bills/AP → query Accounts Payable Tracker
   - When Rene asks for transactions → query Cash Transactions database

2. MONTHLY CLOSE — Check the Monthly Close Checklist for each month's status.
   Cycle: bank recon → categorize transactions → journal entries → P&L → balance sheet.

3. ACCOUNTS PAYABLE — Track all vendor bills in the AP Tracker.
   When a new invoice arrives (like Lowe Graham Jones), add it to AP Tracker.

DEPARTMENT RULES:
- Every dollar figure MUST cite its source
- Use query_notion_database to pull real transaction data
- Create structured Notion pages for data deliverables (tables, not paragraphs)
- When recording transactions, categorize them using the Chart of Accounts
- New invoices → add to AP Tracker with vendor, amount, due date, status
- Cross-reference bank statements when available`,
  },

  sales: {
    id: "sales",
    name: "Sales & Wholesale",
    description:
      "Manages B2B relationships, distributor partnerships, broker coordination, " +
      "retail placement, and wholesale pricing.",
    databases: [
      "b2b_prospects",
      "distributor_prospects",
    ],
    workstreams: [
      {
        id: "ws-walmart-trending",
        name: "Walmart Trending NOW Placement",
        status: "active",
        description:
          "Reid Mitchell (broker, 5% commission) has appointment with Walmart Trending NOW buyer. " +
          "Check lane impulse placement. Pricing: $2.25 delivered, 6-pack cases at $13.50. " +
          "50K unit production run completing mid-April.",
        owner: "Reid Mitchell",
      },
      {
        id: "ws-inderbitzin",
        name: "Inderbitzin Distribution",
        status: "active",
        description:
          "Active distributor relationship with Inderbitzin. Vendor form submitted. " +
          "Key contacts: Brent Overman, Jenny Inderbitzin, Rosa.",
      },
      {
        id: "ws-b2b-pipeline",
        name: "B2B Prospect Pipeline",
        status: "active",
        description:
          "Ongoing outbound and inbound wholesale prospect management. " +
          "Track prospects through stages: lead → contacted → interested → negotiating → closed.",
      },
    ],
    systemContext: `You are operating as USA Gummies' SALES & WHOLESALE department.

ACTIVE WORKSTREAMS:
1. WALMART TRENDING NOW — Reid Mitchell (broker) has buyer appointment
   - Pricing: $2.25/unit delivered, 6-pack case = $13.50
   - Reid gets 5% commission on net invoice
   - 50K unit production run completing mid-April

2. INDERBITZIN DISTRIBUTION — Active distributor, vendor form submitted
   - Contacts: Brent Overman, Jenny Inderbitzin, Rosa

3. B2B PIPELINE — Ongoing prospect management

DEPARTMENT RULES:
- Never expose our COGS or internal margins to external contacts
- Always check the B2B prospects database before responding to new inquiries
- Track all prospect interactions in Notion
- Pricing decisions above $2.25/unit need Ben's approval`,
  },

  operations: {
    id: "operations",
    name: "Operations & Supply Chain",
    description:
      "Manages production, co-packing, ingredient sourcing, inventory, " +
      "fulfillment, and shipping.",
    databases: [
      "repacker_list",
      "inventory",
      "sku_registry",
    ],
    workstreams: [
      {
        id: "ws-production-50k",
        name: "50K Unit Production Run",
        status: "active",
        description:
          "Active production run with Powers Confections (Bill Turley). " +
          "50,000 units, completing mid-April 2026. " +
          "Ingredients from Albanese (Shana Keefe).",
        owner: "Powers Confections",
      },
      {
        id: "ws-inventory-mgmt",
        name: "Inventory Management",
        status: "active",
        description:
          "Track inventory levels across warehouse and 3PL. " +
          "Current on-hand inventory is spoken for (allocated to existing orders). " +
          "New inventory from 50K run available mid-April.",
      },
    ],
    systemContext: `You are operating as USA Gummies' OPERATIONS & SUPPLY CHAIN department.

ACTIVE WORKSTREAMS:
1. 50K PRODUCTION RUN — Powers Confections, completing mid-April
   - Ingredients: Albanese (Shana Keefe)
   - Co-packer: Powers Confections (Bill Turley)

2. INVENTORY — Current inventory is fully allocated. New stock mid-April.

DEPARTMENT RULES:
- Always check inventory levels before committing to fulfillment dates
- Production schedule changes need immediate notification to Sales
- Track all vendor communications in Notion`,
  },

  marketing: {
    id: "marketing",
    name: "Marketing",
    description:
      "Manages SEO, social media, content creation, DTC campaigns, " +
      "email marketing, and brand presence.",
    databases: [
      "daily_performance",
      "kpis",
    ],
    workstreams: [
      {
        id: "ws-seo",
        name: "SEO & Content",
        status: "active",
        description: "Blog content pipeline, keyword optimization, organic traffic growth.",
      },
      {
        id: "ws-social",
        name: "Social Media",
        status: "active",
        description: "X/Twitter and Truth Social presence, daily posting cadence.",
      },
    ],
    systemContext: `You are operating as USA Gummies' MARKETING department.

ACTIVE WORKSTREAMS:
1. SEO & CONTENT — Blog pipeline, keyword optimization
2. SOCIAL MEDIA — Daily posting cadence

DEPARTMENT RULES:
- Check GA4 metrics before making campaign decisions
- All content should align with USA Gummies brand (patriotic, all-natural, premium)`,
  },

  support: {
    id: "support",
    name: "Customer Support",
    description: "Handles customer inquiries, order issues, returns, and reviews.",
    databases: [],
    workstreams: [],
    systemContext: `You are operating as USA Gummies' CUSTOMER SUPPORT department.

RULES:
- Be friendly, helpful, and on-brand
- Escalate order issues that need refunds to Ben
- Check Shopify order status before responding to order inquiries`,
  },

  executive: {
    id: "executive",
    name: "Executive / General",
    description: "Cross-department or strategic matters that don't fit a single department.",
    databases: [],
    workstreams: [],
    systemContext: `This is a cross-department or executive matter. Route sub-tasks to the appropriate departments.`,
  },
};

// ---------------------------------------------------------------------------
// Email → Department routing
// ---------------------------------------------------------------------------

/** Known sender → department mappings */
const SENDER_DEPARTMENT_MAP: Record<string, DepartmentId> = {
  // Finance
  "gonz1rene@outlook.com": "finance",
  "billing@lowegrahamjones.com": "finance",

  // Sales
  "info@inderbitzin.com": "sales",
  "jennyi@inderbitzin.com": "sales",
  "brent@inderbitzin.com": "sales",
  "customers@seebiz.com": "sales",

  // Operations
  "bill@powersconfections.com": "operations",
  "shana@albanese.com": "operations",

  // Marketing (newsletters, ad platforms, etc.)
};

/** Domain → department mappings */
const DOMAIN_DEPARTMENT_MAP: Record<string, DepartmentId> = {
  "inderbitzin.com": "sales",
  "powersconfections.com": "operations",
  "albanese.com": "operations",
  "dutchvalley.com": "operations",
  "pirateship.com": "operations",
  "seebiz.com": "sales",
  "lowegrahamjones.com": "finance",
};

/** Keyword patterns for classification fallback */
const KEYWORD_DEPARTMENT_MAP: Array<{ pattern: RegExp; dept: DepartmentId }> = [
  // Finance
  { pattern: /\b(invoice|payment|bill|accounting|books?|ledger|transaction|receipt|tax|p&l|balance sheet|reconcil|ap\b|ar\b|accounts payable|accounts receivable)\b/i, dept: "finance" },
  // Sales
  { pattern: /\b(wholesale|distributor|broker|retail|pricing|quote|order|purchase order|po\b|placement|buyer|store)\b/i, dept: "sales" },
  // Operations
  { pattern: /\b(production|inventory|shipping|fulfillment|co-?pack|ingredient|supply|warehouse|tracking number|shipment)\b/i, dept: "operations" },
  // Marketing
  { pattern: /\b(seo|blog|social media|campaign|ad\b|ads\b|marketing|content|influencer|brand)\b/i, dept: "marketing" },
  // Support
  { pattern: /\b(order issue|refund|return|complaint|review|customer service|damaged|missing)\b/i, dept: "support" },
];

/**
 * Route an email to the appropriate department.
 * Priority: exact sender → domain → keyword analysis → executive (fallback)
 */
export function routeToDepartment(
  senderEmail: string,
  subject: string,
  bodySnippet: string,
): { department: Department; matchReason: string } {
  const email = senderEmail.toLowerCase().trim();
  const domain = email.split("@")[1] || "";

  // 1. Exact sender match
  const senderDept = SENDER_DEPARTMENT_MAP[email];
  if (senderDept) {
    return {
      department: DEPARTMENTS[senderDept],
      matchReason: `sender:${email}`,
    };
  }

  // 2. Domain match
  const domainDept = DOMAIN_DEPARTMENT_MAP[domain];
  if (domainDept) {
    return {
      department: DEPARTMENTS[domainDept],
      matchReason: `domain:${domain}`,
    };
  }

  // 3. Keyword analysis on subject + body
  const text = `${subject} ${bodySnippet}`;
  for (const { pattern, dept } of KEYWORD_DEPARTMENT_MAP) {
    if (pattern.test(text)) {
      return {
        department: DEPARTMENTS[dept],
        matchReason: `keyword:${pattern.source.slice(0, 30)}`,
      };
    }
  }

  // 4. Fallback to executive
  return {
    department: DEPARTMENTS.executive,
    matchReason: "fallback",
  };
}

/**
 * Get workstream context for a department + sender combination.
 * Returns relevant active workstreams as context for the LLM.
 */
export function getWorkstreamContext(
  dept: Department,
  senderEmail?: string,
): string {
  const active = dept.workstreams.filter((w) => w.status === "active");
  if (active.length === 0) return "";

  // If we know the sender owns a workstream, highlight it
  const senderName = senderEmail
    ? Object.entries(SENDER_DEPARTMENT_MAP).find(([e]) => e === senderEmail)?.[0]
    : undefined;

  const lines = active.map((w) => {
    const ownerTag = w.owner ? ` (Owner: ${w.owner})` : "";
    return `- ${w.name}${ownerTag}: ${w.description}`;
  });

  return `\nACTIVE WORKSTREAMS FOR ${dept.name.toUpperCase()}:\n${lines.join("\n")}`;
}

/**
 * Find which workstream(s) a particular email likely relates to.
 */
export function matchWorkstreams(
  dept: Department,
  senderEmail: string,
  subject: string,
  body: string,
): Workstream[] {
  const matches: Workstream[] = [];
  const text = `${senderEmail} ${subject} ${body}`.toLowerCase();

  for (const ws of dept.workstreams) {
    if (ws.status !== "active") continue;

    // Check if sender is the owner
    if (ws.owner && text.includes(ws.owner.toLowerCase())) {
      matches.push(ws);
      continue;
    }

    // Check if workstream keywords appear in the email
    const wsKeywords = ws.name.toLowerCase().split(/\s+/);
    const descKeywords = ws.description.toLowerCase();
    if (wsKeywords.some((kw) => kw.length > 3 && text.includes(kw))) {
      matches.push(ws);
    } else if (descKeywords.split(/[,.]/).some((phrase) => {
      const trimmed = phrase.trim();
      return trimmed.length > 5 && text.includes(trimmed);
    })) {
      matches.push(ws);
    }
  }

  return matches;
}
