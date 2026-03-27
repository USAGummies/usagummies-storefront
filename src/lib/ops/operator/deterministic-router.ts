export interface RoutedAction {
  intent: string;
  action: string;
  params: Record<string, unknown>;
  result: unknown;
  executed: boolean;
  error: string | null;
}

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

export function routeMessage(message: string, _actor: string): RoutedAction | null {
  const trimmed = message.trim();
  const msg = trimmed.toLowerCase();

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
