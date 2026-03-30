export interface RoutedAction {
  intent: string;
  action: string;
  params: Record<string, unknown>;
  result: unknown;
  executed: boolean;
  error: string | null;
}

export type RouteHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type RouteContext = {
  history?: RouteHistoryItem[];
};

function buildAction(
  intent: string,
  action: string,
  params: Record<string, unknown> = {},
): RoutedAction {
  return {
    intent,
    action,
    params,
    result: null,
    executed: false,
    error: null,
  };
}

function extractConversationText(history: RouteHistoryItem[] | undefined): string {
  return Array.isArray(history)
    ? history.map((item) => String(item.content || "")).join("\n").toLowerCase()
    : "";
}

function looksLikeMeetingCorrection(msg: string, conversation: string): boolean {
  if (!/\b(meeting|calendar|schedule|appointment|call(?:\s+with)?|spokane|powers|greg)\b/.test(`${msg}\n${conversation}`)) return false;
  return /\b(you know|it was|was the|how is today|not today|wrong day)\b/.test(msg);
}

function looksLikeMeetingLookup(msg: string, conversation: string): boolean {
  const combined = `${msg}\n${conversation}`;
  const mentionsMeeting = /\b(meeting|calendar|schedule|appointment|call(?:\s+with)?|spokane|powers|greg)\b/.test(combined);
  const asksForDate = /\b(what day|which day|what time|when is|when was|meeting day|schedule|appointment|call with|verify from my email|verify from email|check my email|from my emails?|from email)\b/.test(msg);
  return mentionsMeeting && asksForDate;
}

export function routeMessage(message: string, _actor: string, context: RouteContext = {}): RoutedAction | null {
  const trimmed = message.trim();
  const msg = trimmed.toLowerCase();
  const conversation = extractConversationText(context.history);

  // ── Exact keyword shortcuts ──
  if (msg === "pnl" || msg === "p&l") return buildAction("pnl", "query_qbo_pnl");
  if (msg === "cash") return buildAction("cash", "query_plaid_balance");
  if (msg === "rev" || msg === "revenue") return buildAction("revenue", "query_kpi_revenue");
  if (msg === "vendors") return buildAction("vendors", "query_qbo_vendors");
  if (msg === "transactions") return buildAction("transactions", "query_qbo_purchases");
  if (msg === "review") return buildAction("review", "show_review_transactions");
  if (msg === "pos" || msg === "orders") return buildAction("open_pos", "query_open_pos");
  if (msg === "emails") return buildAction("emails", "search_recent_email");
  if (msg === "help") return buildAction("help", "show_help");
  if (msg === "tasks") return buildAction("tasks", "query_operator_tasks");
  if (msg === "approve") return buildAction("approve", "query_pending_approvals");

  // ── Natural language pattern matching ──
  // Cash / balance / bank questions → Plaid balance (BoA primary)
  if (/\b(cash position|cash balance|bank balance|how much cash|what'?s? (?:our |the )?(?:cash|balance|bank)|bofa|boa|bank of america|checking balance|money (?:do we|in the))\b/i.test(msg)) {
    return buildAction("cash", "query_plaid_balance");
  }
  // P&L / profit / income statement questions
  if (/\b(profit.?(?:and|&)?.?loss|income statement|how.?(?:are|is) (?:we|the company) doing|net income|gross (?:margin|profit)|how much (?:did we|have we) (?:made|earned|spent))\b/i.test(msg)) {
    return buildAction("pnl", "query_qbo_pnl");
  }
  // Invoice questions → QBO invoices (our invoices to customers)
  if (/\b(invoices?|what (?:invoices|bills)|outstanding invoices|ar\b|accounts? receivable|who owes|owed to us|sent invoices)\b/i.test(msg) && !/\bfrom\s+(?:powers|belmark|albanese)\b/i.test(msg)) {
    return buildAction("invoices", "query_qbo_invoices");
  }
  // Vendor / supplier questions
  if (/\b(vendors?|suppliers?|who do we (?:buy|pay|owe)|accounts? payable|ap\b|what do we owe|bills? (?:we|to pay))\b/i.test(msg)) {
    return buildAction("vendors", "query_qbo_vendors");
  }
  // Revenue questions
  if (/\b(revenue|sales|how much (?:did we|have we) (?:sold|made)|daily sales|monthly sales|mtd|month to date)\b/i.test(msg)) {
    return buildAction("revenue", "query_kpi_revenue");
  }
  // Purchase / expense / transaction questions
  if (/\b(transactions?|purchases?|expenses?|what (?:did we|have we) (?:bought|spent|purchased)|recent (?:charges|spending))\b/i.test(msg)) {
    return buildAction("transactions", "query_qbo_purchases");
  }
  // PO / order / pipeline questions
  if (/\b(purchase orders?|p\.?o\.?s?\b|open orders?|pipeline|wholesale orders?|what.?(?:are|is) (?:we|the) waiting|pending orders?)\b/i.test(msg)) {
    return buildAction("open_pos", "query_open_pos");
  }
  // Email questions
  if (/\b(emails?|inbox|what (?:emails?|mail)|check (?:my |our )?(?:email|inbox|mail)|actionable (?:emails?|mail))\b/i.test(msg)) {
    return buildAction("emails", "search_recent_email");
  }

  if (looksLikeMeetingCorrection(msg, conversation)) {
    return buildAction("meeting_correction", "acknowledge_meeting_correction", {
      instruction: trimmed,
    });
  }

  if (looksLikeMeetingLookup(msg, conversation)) {
    return buildAction("meeting_lookup", "query_meeting_context", {
      instruction: trimmed,
    });
  }

  if (msg.startsWith("teach:")) {
    return buildAction("teach", "create_brain_entry", { text: trimmed.slice(6).trim() });
  }

  if (msg.startsWith("correct:")) {
    return buildAction("correct", "correct_brain_entry", { text: trimmed.slice(8).trim() });
  }

  if (msg.startsWith("categorize ") && (msg.includes(" to ") || msg.includes(" as "))) {
    return buildAction("categorize", "categorize_qbo_transaction", { instruction: trimmed });
  }

  if (
    msg.startsWith("export ") ||
    msg.startsWith("send me an excel") ||
    msg.startsWith("send me a spreadsheet")
  ) {
    return buildAction("export", "generate_file", { instruction: trimmed });
  }

  if (msg.startsWith("draft reply to ")) {
    return buildAction("draft_reply", "draft_email_reply", { instruction: trimmed });
  }

  if (
    msg === "good morning" ||
    msg === "morning" ||
    msg === "hey" ||
    msg === "hi" ||
    msg === "gm" ||
    msg === "im up" ||
    msg === "i'm up" ||
    msg === "lets go"
  ) {
    return buildAction("morning_brief", "release_morning_brief");
  }

  return null;
}
