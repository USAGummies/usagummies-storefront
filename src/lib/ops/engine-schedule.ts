/**
 * Engine Schedule Registry — central configuration for all 94 agents.
 *
 * The master scheduler reads this every 5 minutes and dispatches due agents
 * via QStash to the universal executor route.
 *
 * Schedule format strings:
 *   "Daily HH:MM"           — runs once daily at specified ET time
 *   "Weekly DAY HH:MM"      — runs once weekly (Mon, Tue, etc.)
 *   "Monthly 1st HH:MM"     — runs on the 1st of each month
 *   "Every N min"            — runs every N minutes
 *   "Sequence"               — triggered by parent agent, not scheduled directly
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentSchedule = {
  key: string; // e.g., "agent1", "S1", "F3"
  name: string;
  schedule: string;
  /** If true, this agent is a sub-task triggered by a parent — skip scheduling */
  isSequence?: boolean;
};

export type EngineConfig = {
  id: string; // e.g., "b2b", "seo", "supply-chain"
  name: string; // Display name
  scriptFile: string; // Original .mjs script path
  agents: AgentSchedule[];
};

// ---------------------------------------------------------------------------
// Full Registry
// ---------------------------------------------------------------------------

export const ENGINE_REGISTRY: EngineConfig[] = [
  {
    id: "b2b",
    name: "B2B Outbound Engine",
    scriptFile: "usa-gummies-agentic.mjs",
    agents: [
      { key: "agent0", name: "Email Audit", schedule: "Daily 08:50" },
      { key: "agent1", name: "B2B Researcher", schedule: "Daily 08:00" },
      { key: "agent2", name: "Distributor Researcher", schedule: "Daily 08:30" },
      { key: "agent3", name: "B2B Sender", schedule: "Daily 09:00" },
      { key: "agent4", name: "Distributor Sender", schedule: "Daily 09:15" },
      { key: "agent5", name: "Follow-Up Agent", schedule: "Daily 13:00" },
      { key: "agent6", name: "Inbox Monitor", schedule: "Daily 16:00" },
      { key: "agent7", name: "Daily Performance Report", schedule: "Daily 07:45" },
      { key: "agent8", name: "Customer Learning", schedule: "Daily 17:00" },
      { key: "agent9", name: "Bounce Intelligence", schedule: "Daily 17:15" },
      { key: "agent10", name: "Self-Heal Monitor", schedule: "Every 60 min" },
      { key: "agent11", name: "Revenue Attribution Forecast", schedule: "Daily 17:30" },
      { key: "agent12", name: "Balanced Contact Verifier", schedule: "Daily 08:40" },
      { key: "agent13", name: "Quota Floor Enforcer", schedule: "Daily 11:00" },
      { key: "agent16", name: "KPI Governor", schedule: "Daily 17:45" },
      { key: "agent17", name: "Deliverability SRE", schedule: "Daily 18:00" },
      { key: "agent18", name: "No-Resend Guard", schedule: "Daily 08:55" },
      { key: "agent19", name: "Notion Master Sync", schedule: "Daily 08:52" },
      { key: "agent20", name: "Send Queue Gate", schedule: "Daily 08:57" },
      { key: "agent21", name: "Pipeline Pulse", schedule: "Daily 15:30" },
      { key: "agent22", name: "Distributor Reference Seeder", schedule: "Daily 08:20" },
      { key: "agent23", name: "Deal Progression Tracker", schedule: "Daily 10:00" },
      { key: "agent24", name: "Pricing & Quote Generator", schedule: "Daily 10:30" },
      { key: "agent25", name: "Order Fulfillment Bridge", schedule: "Daily 11:30" },
      { key: "agent26", name: "Win/Loss Analyzer", schedule: "Weekly Mon 18:00" },
      { key: "agent27", name: "Re-engagement Campaigner", schedule: "Daily 14:00" },
      { key: "agent28", name: "Faire Order Monitor", schedule: "Daily 09:30" },
      { key: "agent29", name: "Template A/B Rotator", schedule: "Weekly Sun 19:00" },
      { key: "agent30", name: "Contact Enrichment Agent", schedule: "Daily 12:00" },
    ],
  },
  {
    id: "seo",
    name: "SEO Engine",
    scriptFile: "usa-gummies-seo-engine.mjs",
    agents: [
      { key: "S1", name: "Keyword Opportunity Scanner", schedule: "Weekly Mon 07:00" },
      { key: "S2", name: "Content Gap Analyzer", schedule: "Weekly Tue 07:00" },
      { key: "S3", name: "Blog Post Drafter", schedule: "Weekly Wed 07:00" },
      { key: "S4", name: "Internal Link Optimizer", schedule: "Weekly Thu 07:00" },
      { key: "S5", name: "Blog Performance Tracker", schedule: "Daily 20:00" },
      { key: "S6", name: "Featured Snippet Optimizer", schedule: "Weekly Fri 07:00" },
      { key: "S7", name: "Sitemap & Schema Validator", schedule: "Weekly Sat 07:00" },
      { key: "S8", name: "Content Calendar Manager", schedule: "Weekly Sun 07:00" },
      { key: "S9", name: "Self-Heal Monitor", schedule: "Every 60 min" },
    ],
  },
  {
    id: "dtc",
    name: "DTC Engine",
    scriptFile: "usa-gummies-dtc-engine.mjs",
    agents: [
      { key: "D1", name: "New Customer Ingestor", schedule: "Daily 08:00" },
      { key: "D2", name: "Post-Purchase Sequence Mgr", schedule: "Daily 09:00" },
      { key: "D3", name: "Review Solicitor", schedule: "Sequence", isSequence: true },
      { key: "D4", name: "Referral Program Manager", schedule: "Sequence", isSequence: true },
      { key: "D5", name: "Reorder Predictor", schedule: "Daily 10:00" },
      { key: "D6", name: "Churn Risk Scorer", schedule: "Daily 11:00" },
      { key: "D7", name: "Loyalty Tier Calculator", schedule: "Weekly Mon 07:00" },
      { key: "D8", name: "Email Deliverability Guard", schedule: "Daily 18:00" },
      { key: "D9", name: "DTC Daily Report", schedule: "Daily 19:00" },
      { key: "D10", name: "Self-Heal Monitor", schedule: "Every 60 min" },
    ],
  },
  {
    id: "supply-chain",
    name: "Supply Chain Engine",
    scriptFile: "usa-gummies-supply-chain.mjs",
    agents: [
      { key: "SC1", name: "Inventory Monitor", schedule: "Daily 07:00" },
      { key: "SC2", name: "Supplier Order Tracker", schedule: "Daily 07:15" },
      { key: "SC3", name: "Demand Forecaster", schedule: "Daily 07:30" },
      { key: "SC4", name: "Supplier Health Scorer", schedule: "Weekly Mon 07:00" },
      { key: "SC5", name: "Cost Optimization Analyzer", schedule: "Monthly 1st 08:00" },
      { key: "SC6", name: "Quality Metrics Tracker", schedule: "Daily 12:00" },
      { key: "SC7", name: "Logistics Optimizer", schedule: "Daily 13:00" },
      { key: "SC8", name: "Self-Heal Monitor", schedule: "Every 60 min" },
    ],
  },
  {
    id: "revenue-intel",
    name: "Revenue Intelligence Engine",
    scriptFile: "usa-gummies-revenue-intel.mjs",
    agents: [
      { key: "R1", name: "Revenue Dashboard Compiler", schedule: "Daily 21:00" },
      { key: "R2", name: "Channel Mix Analyzer", schedule: "Daily 21:05" },
      { key: "R3", name: "Pricing Elasticity Monitor", schedule: "Daily 21:10" },
      { key: "R4", name: "Customer Cohort Tracker", schedule: "Daily 21:15" },
      { key: "R5", name: "Market Intelligence Scanner", schedule: "Daily 21:20" },
      { key: "R6", name: "Competitive Price Watcher", schedule: "Daily 21:25" },
      { key: "R7", name: "Revenue Forecast Engine", schedule: "Daily 21:30" },
      { key: "R8", name: "Weekly Revenue Report", schedule: "Weekly Sun 22:00" },
      { key: "R9", name: "Monthly Revenue Deep Dive", schedule: "Monthly 1st 22:00" },
      { key: "R10", name: "Alert & Anomaly Detector", schedule: "Daily 21:35" },
      { key: "R11", name: "Executive Briefing Generator", schedule: "Weekly Sun 22:30" },
      { key: "R12", name: "Self-Heal Monitor", schedule: "Every 60 min" },
      { key: "R13", name: "Daily KPI Collector", schedule: "Daily 22:00" },
    ],
  },
  {
    id: "finops",
    name: "FinOps Engine",
    scriptFile: "usa-gummies-finops.mjs",
    agents: [
      { key: "F1", name: "Transaction Ingestor", schedule: "Daily 07:00" },
      { key: "F2", name: "Invoice Reconciler", schedule: "Daily 07:15" },
      { key: "F3", name: "Expense Categorizer", schedule: "Daily 07:30" },
      { key: "F4", name: "Cash Flow Monitor", schedule: "Daily 07:45" },
      { key: "F5", name: "Margin Calculator", schedule: "Daily 08:00" },
      { key: "F6", name: "Budget vs Actual Tracker", schedule: "Daily 10:00" },
      { key: "F7", name: "Accounts Receivable Monitor", schedule: "Daily 10:15" },
      { key: "F8", name: "Financial Alert System", schedule: "Daily 11:00" },
      { key: "F9", name: "Weekly P&L Generator", schedule: "Weekly Sun 20:00" },
      { key: "F10", name: "Monthly Tax Prep", schedule: "Monthly 1st 09:00" },
      { key: "F11", name: "Self-Heal Monitor", schedule: "Every 60 min" },
      { key: "F12", name: "Monthly Close Prep", schedule: "Monthly 3rd 09:00" },
      { key: "F13", name: "Monthly P&L Statement", schedule: "Monthly 3rd 10:00" },
      { key: "F14", name: "Auto-Categorize Transactions", schedule: "Daily 07:35" },
      { key: "F15", name: "Revenue Reconciliation", schedule: "Monthly 5th 10:00" },
    ],
  },
  {
    id: "social",
    name: "Social Engine",
    scriptFile: "usa-gummies-social-engine.mjs",
    agents: [
      { key: "SOC1", name: "X Mention Monitor", schedule: "Every 60 min" },
      { key: "SOC2", name: "Truth Social Monitor", schedule: "Every 60 min" },
      { key: "SOC3", name: "Social Performance Tracker", schedule: "Daily 20:00" },
      { key: "SOC4", name: "Auto-Responder", schedule: "Sequence", isSequence: true },
    ],
  },
  {
    id: "marketing-autopost",
    name: "Marketing Auto-Post Engine",
    scriptFile: "usa-gummies-marketing-autopost.mjs",
    agents: [
      { key: "MKT1", name: "Daily Social Post Generator", schedule: "Daily 10:00" },
      { key: "MKT2", name: "Content Recycler", schedule: "Daily 14:00" },
      { key: "MKT3", name: "Auto-Post History Reporter", schedule: "Daily 20:00" },
    ],
  },
  {
    id: "sweeps",
    name: "Scheduled Intelligence Loops",
    scriptFile: "internal-sweeps",
    agents: [
      { key: "email-sweep", name: "Email Sweep", schedule: "Every 15 min" },
      { key: "bank-feed-sweep", name: "Bank Feed Sweep", schedule: "Every 60 min" },
      { key: "morning-brief", name: "Morning Brief", schedule: "Daily 08:00" },
      { key: "approval-expiry", name: "Approval Expiry", schedule: "Every 60 min" },
      { key: "evening-recon", name: "Evening Recon", schedule: "Daily 21:00" },
    ],
  },
  {
    id: "abra-sync",
    name: "Abra Brain Sync Engine",
    scriptFile: "abra-brain-sync.mjs",
    agents: [
      { key: "ABRA1", name: "Email Ingest (Incremental)", schedule: "Daily 06:00" },
      { key: "ABRA2", name: "Notion B2B Sync", schedule: "Daily 06:10" },
      { key: "ABRA3", name: "Notion Distributor Sync", schedule: "Daily 06:15" },
      { key: "ABRA4", name: "Notion SKU Sync", schedule: "Weekly Mon 06:20" },
      { key: "ABRA5", name: "Notion Performance Sync", schedule: "Daily 22:00" },
      { key: "ABRA6", name: "Notion Finance Sync", schedule: "Daily 22:05" },
      { key: "ABRA7", name: "Notion Repacker Sync", schedule: "Weekly Wed 06:20" },
      { key: "ABRA8", name: "Notion Agent Run Log Sync", schedule: "Daily 22:10" },
      { key: "ABRA9", name: "Auto-Teach Knowledge Feeds", schedule: "Daily 06:30" },
      { key: "ABRA10", name: "Morning Brief", schedule: "Daily 07:45" },
      { key: "ABRA11", name: "Proactive Alert Scanner", schedule: "Every 60 min" },
      { key: "ABRA12", name: "Agent Health Monitor", schedule: "Daily 18:00" },
      { key: "ABRA13", name: "Dead Letter Recovery", schedule: "Every 60 min" },
      { key: "ABRA14", name: "Weekly Digest", schedule: "Weekly Sun 18:00" },
      { key: "ABRA15", name: "Outcome Tracker", schedule: "Daily 20:00" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Schedule parser
// ---------------------------------------------------------------------------

type ParsedSchedule =
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; day: string; hour: number; minute: number }
  | { type: "monthly"; dayOfMonth: number; hour: number; minute: number }
  | { type: "interval"; minutes: number }
  | { type: "sequence" };

export function parseSchedule(schedule: string): ParsedSchedule {
  const s = schedule.trim();

  // "Every N min"
  const intervalMatch = s.match(/^Every\s+(\d+)\s+min/i);
  if (intervalMatch) return { type: "interval", minutes: parseInt(intervalMatch[1]) };

  // "Sequence"
  if (s.toLowerCase() === "sequence") return { type: "sequence" };

  // "Daily HH:MM"
  const dailyMatch = s.match(/^Daily\s+(\d{1,2}):(\d{2})/i);
  if (dailyMatch) {
    return { type: "daily", hour: parseInt(dailyMatch[1]), minute: parseInt(dailyMatch[2]) };
  }

  // "Weekly DAY HH:MM"
  const weeklyMatch = s.match(/^Weekly\s+(\w+)\s+(\d{1,2}):(\d{2})/i);
  if (weeklyMatch) {
    return {
      type: "weekly",
      day: weeklyMatch[1],
      hour: parseInt(weeklyMatch[2]),
      minute: parseInt(weeklyMatch[3]),
    };
  }

  // "Monthly 1st HH:MM" or "Monthly Nth HH:MM"
  const monthlyMatch = s.match(/^Monthly\s+(\d+)\w*\s+(\d{1,2}):(\d{2})/i);
  if (monthlyMatch) {
    return {
      type: "monthly",
      dayOfMonth: parseInt(monthlyMatch[1]),
      hour: parseInt(monthlyMatch[2]),
      minute: parseInt(monthlyMatch[3]),
    };
  }

  // Fallback formats from b2b engine: "@ HH:MM"
  const atMatch = s.match(/(\d{1,2}):(\d{2})/);
  if (atMatch) {
    return { type: "daily", hour: parseInt(atMatch[1]), minute: parseInt(atMatch[2]) };
  }

  // Fallback: treat as sequence
  return { type: "sequence" };
}

// ---------------------------------------------------------------------------
// isDue — check if an agent should run at this time
// ---------------------------------------------------------------------------

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Check if an agent is due to run, given the current ET time.
 * The master scheduler runs every 5 min, so we match within a 5-min window.
 */
export function isDue(schedule: string, nowET: Date): boolean {
  const parsed = parseSchedule(schedule);

  if (parsed.type === "sequence") return false; // Never auto-scheduled

  const etHour = nowET.getHours();
  const etMin = nowET.getMinutes();
  const etDay = nowET.getDay();
  const etDate = nowET.getDate();

  if (parsed.type === "interval") {
    // "Every 30 min" — runs at :00 and :30 (for 30 min interval)
    // Match if current minute is within 5 min of a scheduled slot
    return etMin % parsed.minutes < 5;
  }

  if (parsed.type === "daily") {
    return etHour === parsed.hour && etMin >= parsed.minute && etMin < parsed.minute + 5;
  }

  if (parsed.type === "weekly") {
    const targetDay = DAY_MAP[parsed.day.toLowerCase()];
    if (targetDay === undefined) return false;
    return (
      etDay === targetDay &&
      etHour === parsed.hour &&
      etMin >= parsed.minute &&
      etMin < parsed.minute + 5
    );
  }

  if (parsed.type === "monthly") {
    return (
      etDate === parsed.dayOfMonth &&
      etHour === parsed.hour &&
      etMin >= parsed.minute &&
      etMin < parsed.minute + 5
    );
  }

  return false;
}

/**
 * Get all agents that are due to run right now.
 */
export function getDueAgents(nowET: Date): Array<{ engineId: string; agent: AgentSchedule }> {
  const due: Array<{ engineId: string; agent: AgentSchedule }> = [];
  for (const engine of ENGINE_REGISTRY) {
    for (const agent of engine.agents) {
      if (!agent.isSequence && isDue(agent.schedule, nowET)) {
        due.push({ engineId: engine.id, agent });
      }
    }
  }
  return due;
}
