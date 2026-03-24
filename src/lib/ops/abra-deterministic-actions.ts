/**
 * Abra Deterministic Action Parser
 *
 * Detects user intent from the message text and executes actions BEFORE
 * the LLM runs. The LLM then composes a response based on the results.
 *
 * This eliminates the #1 failure mode: Claude saying "On it" but not
 * emitting an <action> block.
 *
 * ARCHITECTURE:
 *   User message → detectAndExecute() → { preloadedData, actionsExecuted }
 *   → LLM gets preloadedData as context → composes intelligent response
 *
 * The LLM never decides WHETHER to act. It only decides HOW to respond
 * to the results of actions that already executed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreExecutionResult = {
  /** Data fetched by pre-executed actions, injected into LLM context */
  preloadedData: string;
  /** Action notices to append to the reply */
  actionNotices: string[];
  /** Whether any pre-execution happened */
  didPreExecute: boolean;
  /** Actions that were executed (for dedup — don't re-execute in post-LLM) */
  executedActionTypes: Set<string>;
};

type DetectedAction = {
  type: string;
  params: Record<string, unknown>;
  priority: number; // lower = execute first
};

// ---------------------------------------------------------------------------
// Intent Detection Patterns
// ---------------------------------------------------------------------------

const PATTERNS: Array<{
  regex: RegExp;
  actionType: string;
  extractParams: (match: RegExpMatchArray, message: string) => Record<string, unknown>;
  priority: number;
}> = [
  // ── EMAIL READING ──
  {
    regex: /\b(read|check|pull|show|get|find|look at|review|scan)\b.*\b(emails?|inbox|mail|messages?)\b/i,
    actionType: "search_email",
    extractParams: (match, msg) => {
      const fromMatch = /\b(?:from|by)\s+(\w+(?:\s+\w+)?)/i.exec(msg);
      const countMatch = /\b(\d+)\s+emails?\b/i.exec(msg);
      const count = countMatch ? Math.min(parseInt(countMatch[1], 10), 10) : 5;
      let query: string;
      if (fromMatch) {
        query = `from:${fromMatch[1]}`;
      } else if (/\b(today|recent|latest|last|new|unread)\b/i.test(msg)) {
        query = "newer_than:1d";
      } else {
        query = "newer_than:2d";
      }
      return { query, count };
    },
    priority: 1,
  },

  // ── EMAIL RESPONSE CHECK ──
  {
    regex: /\b(which|what)\b.*\b(emails?|messages?)\b.*\b(need|require|await|waiting)\b.*\b(response|reply|answer)\b/i,
    actionType: "search_email",
    extractParams: () => ({ query: "newer_than:3d is:inbox", count: 10 }),
    priority: 1,
  },

  // ── SPECIFIC SENDER EMAIL ──
  {
    regex: /\b(?:email|message|thread|correspondence)\b.*\b(?:from|by|with)\s+(reid|greg|powers|albanese|patrick|inderbitzin|belmark|rene|andrew|nick|paulino|bill|dutch|eco|rangeme|faire)/i,
    actionType: "search_email",
    extractParams: (match) => ({
      query: `from:${match[1]}`,
      count: 3,
    }),
    priority: 1,
  },

  // ── QBO QUERIES ──
  {
    regex: /\b(balance sheet|p&l|profit.?(?:and|&).?loss|cash flow|vendor(?:s| list)|chart of accounts|COA|accounts? (?:receivable|payable))\b/i,
    actionType: "query_qbo",
    extractParams: (match) => {
      const msg = match[0].toLowerCase();
      if (/balance sheet/i.test(msg)) return { query_type: "balance_sheet" };
      if (/p&l|profit/i.test(msg)) return { query_type: "pnl" };
      if (/cash flow/i.test(msg)) return { query_type: "cash_flow" };
      if (/vendor/i.test(msg)) return { query_type: "vendors" };
      if (/chart|coa|accounts/i.test(msg)) return { query_type: "accounts" };
      return { query_type: "metrics" };
    },
    priority: 2,
  },

  // ── QBO VENDOR CREATION ──
  {
    regex: /\b(create|add|set up|make)\b.*\b(vendor|supplier)\b.*?(?:(?:for|called|named|:|\u2014|-)\s*)?["']?([A-Z][A-Za-z\s&.'-]{2,40})/i,
    actionType: "create_qbo_vendor",
    extractParams: (match) => ({
      name: match[3].trim(),
    }),
    priority: 3,
  },

  // ── QBO ACCOUNT CREATION ──
  {
    regex: /\b(create|add|set up)\b.*\b(account|coa)\b.*?(?:(?:for|called|named|:)\s*)?["']?([A-Z][A-Za-z\s:&.'-]{2,40})/i,
    actionType: "create_qbo_account",
    extractParams: (match) => ({
      name: match[3].trim(),
      type: "Expense", // default, will be refined by LLM
    }),
    priority: 3,
  },

  // ── EXCEL/FILE GENERATION ──
  {
    regex: /\b(generate|create|make|give me|export|build)\b.*\b(excel|spreadsheet|xlsx|csv|file|export|report)\b/i,
    actionType: "generate_file",
    extractParams: (_match, msg) => {
      // Try to infer the data source
      if (/vendor/i.test(msg)) return { filename: "vendors.xlsx", source: "qbo_vendors" };
      if (/chart of accounts|coa/i.test(msg)) return { filename: "chart_of_accounts.xlsx", source: "qbo_accounts" };
      if (/p&l|profit|loss/i.test(msg)) return { filename: "pnl.xlsx", source: "qbo_pnl" };
      if (/revenue|daily|kpi/i.test(msg)) return { filename: "revenue.xlsx", source: "kpi_daily_revenue" };
      if (/landed|freight|mclane|cost/i.test(msg)) return { filename: "landed_costs.xlsx", source: "" }; // LLM will build rows
      return { filename: "export.xlsx", source: "" };
    },
    priority: 2,
  },

  // ── TASK CREATION ──
  {
    regex: /\b(create|add|make|log)\b.*\b(task|todo|reminder|action item)\b.*?(?:to |for |about |— |: )(.{5,80})/i,
    actionType: "create_task",
    extractParams: (match) => ({
      title: match[3].trim().replace(/[.!?]$/, ""),
    }),
    priority: 3,
  },

  // ── AI SPEND ──
  {
    regex: /\b(ai|anthropic|claude)\b.*\b(spend|cost|budget|usage|bill)\b/i,
    actionType: "_cost_query",
    extractParams: () => ({}),
    priority: 1,
  },

  // ── REVENUE/KPI QUERIES ──
  {
    regex: /\b(revenue|sales|orders?|aov)\b.*\b(today|yesterday|this week|this month|mtd|last \d+ days|march|february)\b/i,
    actionType: "query_kpi",
    extractParams: (_match, msg) => {
      if (/today/i.test(msg)) return { date: new Date().toISOString().slice(0, 10) };
      if (/yesterday/i.test(msg)) return { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10) };
      return {};
    },
    priority: 1,
  },

  // ── CASH POSITION ──
  {
    regex: /\b(cash|bank|balance|how much (?:money|cash|do we have))\b/i,
    actionType: "_cash_query",
    extractParams: () => ({}),
    priority: 1,
  },
];

// ---------------------------------------------------------------------------
// Core Detection & Execution
// ---------------------------------------------------------------------------

/**
 * Detect actionable intents in the message and pre-execute them.
 * Returns data that gets injected into the LLM context.
 */
export async function detectAndPreExecute(
  message: string,
  ctx?: {
    slackChannelId?: string;
    slackThreadTs?: string;
  },
): Promise<PreExecutionResult> {
  const result: PreExecutionResult = {
    preloadedData: "",
    actionNotices: [],
    didPreExecute: false,
    executedActionTypes: new Set(),
  };

  // Find all matching patterns
  const detected: DetectedAction[] = [];
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(message);
    if (match) {
      detected.push({
        type: pattern.actionType,
        params: pattern.extractParams(match, message),
        priority: pattern.priority,
      });
    }
  }

  if (detected.length === 0) return result;

  // Sort by priority and deduplicate by type
  detected.sort((a, b) => a.priority - b.priority);
  const seen = new Set<string>();
  const unique = detected.filter((d) => {
    if (seen.has(d.type)) return false;
    seen.add(d.type);
    return true;
  });

  // Execute up to 3 actions (prevent runaway)
  const maxActions = 3;
  const toExecute = unique.slice(0, maxActions);

  console.log(`[deterministic] Detected ${toExecute.length} actions: ${toExecute.map(a => a.type).join(", ")}`);

  for (const action of toExecute) {
    try {
      console.log(`[deterministic] Executing pre-action: ${action.type} with params: ${JSON.stringify(action.params).slice(0, 200)}`);
      const data = await executePreAction(action, ctx);
      console.log(`[deterministic] Pre-action ${action.type} result: ${data ? data.slice(0, 100) : "null"}`);
      if (data) {
        result.preloadedData += `\n\n--- PRE-EXECUTED: ${action.type} ---\n${data}`;
        result.didPreExecute = true;
        result.executedActionTypes.add(action.type);
      }
    } catch (err) {
      console.error(`[deterministic] Pre-action ${action.type} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Action Executors
// ---------------------------------------------------------------------------

async function executePreAction(
  action: DetectedAction,
  ctx?: { slackChannelId?: string; slackThreadTs?: string },
): Promise<string | null> {
  switch (action.type) {
    case "search_email": {
      const { searchEmails } = await import("@/lib/ops/gmail-reader");
      const query = String(action.params.query || "newer_than:2d");
      const count = Number(action.params.count || 5);
      const emails = await searchEmails(query, count);
      if (!emails || emails.length === 0) return `No emails found for "${query}".`;

      const maxBody = 1000;
      const summaries = emails.map((e) => {
        const body = (e.body || "").slice(0, maxBody);
        return `From: ${e.from}\nTo: ${e.to}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${body}${e.body.length > maxBody ? "\n[...truncated]" : ""}`;
      });
      return `Found ${emails.length} emails:\n\n${summaries.join("\n\n---\n\n")}`;
    }

    case "query_qbo": {
      const queryType = String(action.params.query_type || "metrics");
      const host = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4000");
      const secret = process.env.CRON_SECRET?.trim();
      if (!secret) return null;

      const res = await fetch(`${host}/api/ops/qbo/query?type=${queryType}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return `QBO query failed: ${res.status}`;
      const data = await res.json();
      return JSON.stringify(data, null, 2).slice(0, 3000);
    }

    case "create_qbo_vendor": {
      const name = String(action.params.name || "");
      if (!name) return null;
      const host = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4000");
      const secret = process.env.CRON_SECRET?.trim();
      if (!secret) return null;

      const res = await fetch(`${host}/api/ops/qbo/vendor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return `Vendor creation failed: ${res.status}`;
      const data = await res.json();
      return `✅ Created vendor "${name}" in QBO (ID: ${data.vendor_id})`;
    }

    case "generate_file": {
      const source = String(action.params.source || "");
      if (!source) return null; // LLM will handle custom data files
      // File generation with source is handled by the action executor — flag it
      return `FILE_GENERATION_REQUESTED: source=${source}, filename=${action.params.filename}`;
    }

    case "create_task": {
      const title = String(action.params.title || "");
      if (!title) return null;
      // Task creation goes through the standard action system
      return `TASK_CREATION_REQUESTED: title="${title}"`;
    }

    case "_cost_query": {
      // Cost queries are handled by the intent router's cost fast-path
      return null; // Let the existing system handle it
    }

    case "_cash_query": {
      // Try Plaid first
      try {
        const host = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4000");
        const secret = process.env.CRON_SECRET?.trim();
        if (!secret) return null;
        const res = await fetch(`${host}/api/ops/qbo/query?type=balance_sheet`, {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json();
          return `BALANCE SHEET DATA:\n${JSON.stringify(data, null, 2).slice(0, 2000)}`;
        }
      } catch { /* fall through */ }
      return null;
    }

    case "query_kpi": {
      // KPI queries are handled by the existing system
      return null;
    }

    default:
      return null;
  }
}
