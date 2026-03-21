/**
 * Abra Intent Router — Lightweight multi-agent orchestration
 *
 * Classifies incoming messages to determine which specialized agent
 * should handle them. Each agent has a focused system prompt (~20% of
 * the full prompt), reducing token cost and improving accuracy.
 *
 * This is a stepping stone toward full multi-agent: it routes intent
 * but still uses a single Claude call. The win is smaller, domain-specific
 * system prompts that produce better answers.
 */

export type AgentDomain =
  | "finance"      // QBO, P&L, cash, reconciliation, bookkeeping
  | "supply_chain" // Vendors, production, inventory, co-packing
  | "sales"        // Pipeline, B2B, wholesale, DTC, Amazon
  | "operations"   // System health, scheduling, tasks, general ops
  | "identity"     // Company facts, team, structure, URL, etc.
  | "general";     // Everything else

type IntentRule = {
  domain: AgentDomain;
  patterns: RegExp[];
  priority: number; // Higher = checked first
};

const INTENT_RULES: IntentRule[] = [
  {
    domain: "finance",
    priority: 10,
    patterns: [
      /\b(revenue|profit|loss|margin|cogs|cost|expense|invoice|payment|transaction|categorize|reconcil|qbo|quickbooks|bank|cash|balance|budget|spend|p&l|pnl|income|liability|asset|equity|chart of accounts|coa|gl account|burn rate|runway)\b/i,
      /\b(rene|bookkeep|accounti|tax|form 1120|investor loan|wire|deposit)\b/i,
    ],
  },
  {
    domain: "supply_chain",
    priority: 9,
    patterns: [
      /\b(vendor|supplier|powers|albanese|belmark|ninja|pirate ship|co-?pack|production run|inventory|units|cases|sku|packaging|film|freight|shipping|warehouse|reorder)\b/i,
      /\b(greg|kroetch|bill thurner|dutch valley)\b/i,
    ],
  },
  {
    domain: "sales",
    priority: 8,
    patterns: [
      /\b(pipeline|prospect|lead|deal|outreach|wholesale|distributor|inderbitzin|patrick|b2b|sample|follow.up|aov|orders|channel mix|shopify.*revenue|amazon.*revenue|faire)\b/i,
    ],
  },
  {
    domain: "identity",
    priority: 7,
    patterns: [
      /\b(are we|do we|what type|what kind|corporation|supplement|who is|team|headcount|url|store|chatgpt|who are you)\b/i,
      /\b(founded|incorporated|wyoming|c.corp|form 1120)\b/i,
    ],
  },
  {
    domain: "operations",
    priority: 5,
    patterns: [
      /\b(health|status|system|integration|deploy|cron|alert|signal|self.monitor|brain|teach|correct|task|schedule|morning brief)\b/i,
    ],
  },
];

/**
 * Classify a message to determine which agent domain should handle it.
 * Returns the domain with the highest priority match.
 */
export function classifyIntent(message: string): AgentDomain {
  let bestMatch: AgentDomain = "general";
  let bestPriority = 0;

  for (const rule of INTENT_RULES) {
    if (rule.priority <= bestPriority) continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        bestMatch = rule.domain;
        bestPriority = rule.priority;
        break;
      }
    }
  }

  return bestMatch;
}

/**
 * Get domain-specific context additions for the classified intent.
 * These are injected into the system prompt to focus Claude's response.
 */
export function getDomainContext(domain: AgentDomain): string {
  switch (domain) {
    case "finance":
      return `DOMAIN FOCUS: FINANCE
You are answering a finance/bookkeeping question. Prioritize:
- QBO data, Plaid balances, and verified ledger entries
- Account categorization guidance (use the Chart of Accounts)
- Rene is the bookkeeper — be collaborative and specific with account IDs
- Investor transfers from Rene → ALWAYS liability (Account 2300), NEVER income
- Bank of America is the primary bank (not Found Banking)`;

    case "supply_chain":
      return `DOMAIN FOCUS: SUPPLY CHAIN
You are answering a supply chain question. Prioritize:
- Vendor details: Powers ($0.385/unit co-packing), Albanese ($39.20/case SKU 50270), Belmark (packaging film)
- Production run status: 50K unit run with Powers in planning
- Inventory levels and runway calculations
- Greg Kroetch at Powers is the primary vendor contact`;

    case "sales":
      return `DOMAIN FOCUS: SALES & PIPELINE
You are answering a sales question. Prioritize:
- B2B pipeline data from Notion
- Channel performance: Amazon (~81% revenue), Shopify DTC (~19%)
- Wholesale prospects and follow-up status
- AOV targets: DTC $35, Amazon $6-7`;

    case "identity":
      return `DOMAIN FOCUS: COMPANY IDENTITY
Answer with maximum brevity. One sentence for yes/no questions.
- USA Gummies: confectionery candy, NOT supplements
- Wyoming C-Corp, Form 1120
- Store: usagummies.com (Shopify)
- Team: Ben (CEO), Andrew (Ops), Rene (Finance)`;

    case "operations":
      return `DOMAIN FOCUS: OPERATIONS & SYSTEM
You are answering an operations question. Cover system health, scheduling, brain entries, task management.`;

    default:
      return "";
  }
}
