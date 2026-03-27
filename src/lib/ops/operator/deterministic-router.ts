export interface RoutedAction {
  intent: string;
  action: string;
  params: Record<string, unknown>;
  result: unknown;
  executed: boolean;
  error: string | null;
}

function extractNameAfter(message: string, pattern: RegExp): string {
  const match = message.match(pattern);
  return match?.[1]?.trim() || "";
}

function parseInvoiceInstruction(message: string): Record<string, unknown> {
  const customerName =
    extractNameAfter(message, /\binvoice\s+for\s+([^,]+?)(?:,|$)/i) ||
    extractNameAfter(message, /\bfor\s+([^,]+?)(?:,|$)/i);
  const quantityMatch = message.match(/\b(\d[\d,]*)\s+(units?|bags?)\b/i);
  const quantity = quantityMatch ? Number(quantityMatch[1].replace(/,/g, "")) : null;
  const priceMatch = message.match(/\$([\d,.]+)\s*(?:\/|per)?\s*(?:unit|bag)?/i);
  const unitPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
  return {
    customerName,
    quantity,
    unitPrice,
  };
}

export function routeMessage(message: string, _actor: string): RoutedAction | null {
  const msg = message.toLowerCase().trim();

  if (/^(good morning|morning)$/i.test(msg)) {
    return { intent: "morning_status", action: "query_company_status", params: { greeting: true }, result: null, executed: false, error: null };
  }
  if (/\b(i'?m heading to spokane now|heading to spokane now|driving to spokane)\b/i.test(msg)) {
    return { intent: "travel_ack", action: "acknowledge_trip", params: {}, result: null, executed: false, error: null };
  }

  if (msg === "?") return { intent: "help", action: "show_help", params: {}, result: null, executed: false, error: null };
  if (/^(rev|revenue)$/i.test(msg)) return { intent: "revenue", action: "query_kpi_revenue", params: {}, result: null, executed: false, error: null };
  if (/^(cash)$/i.test(msg) || /\b(cash position|cash balance|how much cash|bank balance)\b/i.test(msg)) {
    return { intent: "cash", action: "query_plaid_balance", params: {}, result: null, executed: false, error: null };
  }
  if (/^(pnl|p&l)$/i.test(msg) || /\b(show me (the )?p&l|show me (the )?profit and loss|profit and loss)\b/i.test(msg)) {
    return { intent: "pnl", action: "query_qbo_pnl", params: {}, result: null, executed: false, error: null };
  }
  if (/^(vendors?)$/i.test(msg) || /\bwhat vendors?( are)? (set up|in qbo|exist)\b/i.test(msg)) {
    return { intent: "vendors", action: "query_qbo_vendors", params: {}, result: null, executed: false, error: null };
  }
  if (/^(tasks?)$/i.test(msg)) return { intent: "tasks", action: "query_operator_tasks", params: {}, result: null, executed: false, error: null };
  if (/^(approve)$/i.test(msg)) return { intent: "approve", action: "query_pending_approvals", params: {}, result: null, executed: false, error: null };
  if (/^(emails?)$/i.test(msg)) return { intent: "check_email", action: "check_email", params: { query: "newer_than:2d" }, result: null, executed: false, error: null };
  if (/^(review)$/i.test(msg)) return { intent: "review_transactions", action: "show_review_transactions", params: {}, result: null, executed: false, error: null };
  if (/^(help)$/i.test(msg)) return { intent: "help", action: "show_help", params: {}, result: null, executed: false, error: null };

  if (/\b(excel|xlsx|spreadsheet|export|csv)\b/i.test(msg)) {
    return { intent: "generate_file", action: "generate_file", params: { instruction: message }, result: null, executed: false, error: null };
  }

  if (/\b(balance sheet|bs)\b/i.test(msg)) return { intent: "balance_sheet", action: "query_qbo_balance_sheet", params: {}, result: null, executed: false, error: null };
  if (/\b(company status|status of the company|how are things at the company)\b/i.test(msg)) {
    return { intent: "company_status", action: "query_company_status", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(how much did we sell yesterday|yesterday(?:'s)? revenue|revenue yesterday|sales yesterday)\b/i.test(msg)) {
    return { intent: "yesterday_revenue", action: "query_yesterday_revenue", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(inventory position|inventory status|what(?:'s| is) our inventory)\b/i.test(msg)) {
    return { intent: "inventory_position", action: "query_inventory_position", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(what should i ask greg about|prep me for the powers meeting|powers meeting prep)\b/i.test(msg)) {
    return { intent: "meeting_prep", action: "query_meeting_prep", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(what would happen if|scenario)\b.*\bwholesale\b/i.test(msg)) {
    return { intent: "wholesale_scenario", action: "query_wholesale_scenario", params: { instruction: message }, result: null, executed: false, error: null };
  }
  if (/\b(who hasn'?t responded to our distributor samples|distributor samples)\b/i.test(msg)) {
    return { intent: "pipeline_followups", action: "query_pipeline_followups", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(gross margin by channel|margin by channel)\b/i.test(msg)) {
    return { intent: "gross_margin", action: "query_gross_margin_channels", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(top 3 things i should do right now|what should i do right now|focus on today)\b/i.test(msg)) {
    return { intent: "priority_actions", action: "query_priority_actions", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(investor loan balance|how much has rene invested|rene.*invested|investor loan)\b/i.test(msg)) {
    return { intent: "investor_loan", action: "query_investor_loan_balance", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(burn rate)\b/i.test(msg)) {
    return { intent: "burn_rate", action: "query_burn_rate", params: {}, result: null, executed: false, error: null };
  }
  if (/\b(chart of accounts|coa)\b/i.test(msg)) return { intent: "coa", action: "query_qbo_accounts", params: {}, result: null, executed: false, error: null };
  if (/\b(cash flow)\b/i.test(msg)) return { intent: "cash_flow", action: "query_qbo_cash_flow", params: {}, result: null, executed: false, error: null };
  if (/\b(bills?|payable|owe vendors)\b/i.test(msg)) return { intent: "bills", action: "query_qbo_bills", params: {}, result: null, executed: false, error: null };
  if (/\b(create|generate)\b.*\binvoice\b/i.test(msg)) {
    return {
      intent: "create_invoice",
      action: "create_qbo_invoice",
      params: {
        instruction: message,
        ...parseInvoiceInstruction(message),
      },
      result: null,
      executed: false,
      error: null,
    };
  }
  if (/\b(invoices?|receivable|who owes us money)\b/i.test(msg)) return { intent: "invoices", action: "query_qbo_invoices", params: {}, result: null, executed: false, error: null };
  if (/\b(transactions?|purchases?|expenses?)\b/i.test(msg)) return { intent: "transactions", action: "query_qbo_purchases", params: {}, result: null, executed: false, error: null };

  if (/\b(categorize|recategorize)\b.*\b(to|as)\b/i.test(msg)) {
    return { intent: "categorize", action: "categorize_qbo_transaction", params: { instruction: message }, result: null, executed: false, error: null };
  }
  if (/\b(create|add|set up)\b.*\b(vendor|supplier)\b/i.test(msg)) {
    return {
      intent: "create_vendor",
      action: "create_qbo_vendor",
      params: {
        name: extractNameAfter(message, /\b(?:vendor|supplier)\s+(?:for\s+)?(.+)$/i) || extractNameAfter(message, /\bfor\s+(.+)$/i),
        instruction: message,
      },
      result: null,
      executed: false,
      error: null,
    };
  }
  if (/\b(create|add)\b.*\b(customer|client)\b/i.test(msg)) {
    return {
      intent: "create_customer",
      action: "create_qbo_customer",
      params: {
        name: extractNameAfter(message, /\b(?:customer|client)\s+(?:for\s+)?(.+)$/i) || extractNameAfter(message, /\bfor\s+(.+)$/i),
        instruction: message,
      },
      result: null,
      executed: false,
      error: null,
    };
  }
  if (/\b(any new emails?|check my email|check email)\b/i.test(msg)) {
    return { intent: "search_email", action: "search_email", params: { query: "newer_than:2d" }, result: null, executed: false, error: null };
  }
  if (/\b(email|inbox|mail)\b/i.test(msg) && /\b(read|check|show|what|any|new)\b/i.test(msg)) {
    return { intent: "check_email", action: "check_email", params: { query: "newer_than:2d" }, result: null, executed: false, error: null };
  }
  if (/\b(reply|respond|draft)\b.*\b(to|email)\b/i.test(msg)) {
    return { intent: "draft_reply", action: "draft_email_reply", params: { instruction: message }, result: null, executed: false, error: null };
  }

  if (msg.startsWith("teach:")) {
    return { intent: "teach", action: "create_brain_entry", params: { text: message.slice(6).trim() }, result: null, executed: false, error: null };
  }
  if (msg.startsWith("correct:")) {
    return { intent: "correct", action: "correct_brain_entry", params: { text: message.slice(8).trim() }, result: null, executed: false, error: null };
  }

  return null;
}
