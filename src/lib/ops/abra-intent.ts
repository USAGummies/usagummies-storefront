/**
 * Abra Intent Detection — keyword-based intent routing (no LLM).
 *
 * Extracted from the monolithic chat route to keep intent detection
 * testable and isolated from the main request handler.
 */

import { detectDepartment } from "@/lib/ops/department-playbooks";

// ─── Trigger Regexes ───

export const INITIATIVE_TRIGGERS =
  /\b(get .+ under control|let'?s work on|build .+ structure|set up .+ department|organize .+ department|establish .+ process)\b/i;
export const SESSION_TRIGGERS =
  /\b(let'?s (have a |)meet|start a (meeting|session|review)|review .+ department|how'?s .+ doing|check in on)\b/i;
export const COST_TRIGGERS =
  /\b(ai spend|ai cost|how much (?:(?:am i|are we|is abra|does abra|do we) )?spend(?:ing)? on ai|abra(?:'s|'s) (?:monthly )?(?:cost|spend|budget)|monthly ai spend|ai cost report)\b/i;
export const PIPELINE_TRIGGERS =
  /\b(sales pipeline|pipeline health|pipeline status|b2b pipeline|b2b deals?|wholesale deals?|pipeline deals?|active deals?|deal(s| ) (status|details|breakdown)|show .+ pipeline|what deals|which deals|which companies .+ pipeline|who .+ in .+ pipeline|pipeline summary|deal pipeline|b2b prospects?|top .+ deals?|prospects? by .+ value|biggest deals?|largest deals?|deal value)\b/i;
export const STRATEGY_TRIGGERS =
  /\b(create .+ strategy|develop .+ strategy|build .+ strategy|strategic plan|financial plan|budget plan|let'?s (plan|strategize)|design .+ plan)\b/i;
export const DIAGNOSTICS_TRIGGERS =
  /\b(diagnos|self.?check|what'?s broken|are you (working|ok|healthy)|system health|feed status|check yourself|run diagnostics)\b/i;
export const EMAIL_TRIGGERS =
  /\b(check (?:my |the )?(?:email|inbox|mail)|scan (?:my |the )?inbox|any (?:new |unread )?(?:mail|email)|who emailed|check if anyone (?:emailed|sent|wrote)|email from \w+|what(?:'s| is) in (?:my |the )?inbox|anything i owe people|do i owe anyone|unread (?:mail|email)|pull (?:up |)(?:my |the )?(?:email|inbox)|new messages?)\b/i;

export const INVENTORY_TRIGGERS =
  /\b(how much stock|inventory (?:count|level|status)|fba inventory|what(?:'s| is) in stock|stock (?:level|count|check)|warehouse (?:inventory|stock)|inventory (?:on hand|remaining)|how many (?:units|bags|cases)|reorder|stock.?out|out of stock|low stock|amazon (?:inventory|stock|fba))\b/i;

export const REVENUE_TRIGGERS =
  /\b(how much did we (?:make|sell|earn)|what(?:'s| is) our revenue|sales (?:today|yesterday|this (?:week|month)|last (?:week|month))|how are sales|revenue (?:today|yesterday|this (?:week|month))|daily sales|total (?:sales|revenue)|order (?:volume|count|total)|how(?:'s| is) (?:business|revenue) (?:doing|going|looking))\b/i;

export const FINANCE_TRIGGERS =
  /\b(chart of accounts|account balances?|qbo|quickbooks|bank balance|checking balance|credit card balance|p&l|profit.?(?:and|&).?loss|balance sheet|cash position|how much (?:do we have|is in|money)|financial (?:summary|snapshot|report|data)|account(?:s|ing) (?:summary|breakdown)|categoriz|investor loan|rene.?(?:s|'s|'s)? (?:money|loan|transfer|investment)|vendor(?:s| list)?|supplier(?:s)?|co.?pack|cogs|cost of goods|gross margin|expense(?:s| breakdown)|where .* money .* go|spending|purchases?|what (?:are|do) we (?:spend|pay)|who do we (?:pay|buy from)|reconcil|1099|tax (?:liability|filing|return|compliance|status)|estimated (?:quarterly|tax)|accounts (?:receivable|payable)|inventory (?:value|on hand|count|worth)|depreciation|amortization|equity|liabilities|net (?:income|loss|worth)|revenue (?:breakdown|by channel)|burn rate|runway|profitability|breakeven|break.?even|capital structure|funding|every transaction|all transactions|transaction (?:list|detail|history)|general ledger|trial balance|what do the books look|how do the books|book(?:s|keeping)|pull up the p&l|show me the (?:balance sheet|p&l|books)|what(?:'s| is) in qbo|run the p&l|check quickbooks)\b/i;

// ─── Intent Types ───

export type DetectedIntent =
  | { type: "initiative"; department: string | null; goal: string }
  | { type: "session"; department: string | null; sessionType: string }
  | { type: "cost" }
  | { type: "pipeline" }
  | { type: "finance" }
  | { type: "email" }
  | { type: "inventory" }
  | { type: "revenue" }
  | { type: "strategy"; objective: string; department: string | null }
  | { type: "diagnostics" }
  | { type: "chat" };

// ─── Data Paste Detection ───

/**
 * Returns true when the message is structured data being pasted (e.g. a chart
 * of accounts, a tab-separated export, a multi-row table), not a question.
 *
 * Data pastes must NOT be routed to the finance fast-path even though they
 * contain finance keywords like "account", "expense", "income".
 */
export function isDataPaste(message: string): boolean {
  // Must be long enough to be pasted data (not a short question)
  if (message.length < 1500) return false;

  // Count structural indicators
  const newlineCount = (message.match(/\n/g) || []).length;
  const tabCount = (message.match(/\t/g) || []).length;

  // Must have many lines or tab-separated columns
  if (newlineCount < 10 && tabCount < 10) return false;

  // Look for repeated numeric patterns (GL account numbers like 100015, 205010)
  const numericPatterns = (message.match(/\b\d{5,7}\b/g) || []).length;

  // Look for tab-separated or pipe-separated values (table rows)
  const tsvRows = (message.match(/\S+\t\S+/g) || []).length;

  // Look for header-like patterns common in exported data
  const hasDataHeader = /\b(GL Account|Account Type|Account Number|Debit|Credit|Balance|Description|Category|Sub-?type)\b/i.test(message);

  // Low ratio of question words vs. total length is a strong signal
  const questionWords = (message.match(/\b(what|how|why|when|where|who|which|can you|could you|tell me|show me|explain|help|please)\b/gi) || []).length;
  const isLowQuestionDensity = questionWords / message.length < 0.002; // fewer than 2 per 1000 chars

  // Score-based: if multiple structural indicators fire, it's data
  const score =
    (numericPatterns >= 5 ? 2 : 0) +
    (tsvRows >= 5 ? 2 : 0) +
    (hasDataHeader ? 3 : 0) +
    (tabCount >= 20 ? 2 : 0) +
    (newlineCount >= 20 ? 1 : 0) +
    (isLowQuestionDensity ? 1 : 0);

  return score >= 4;
}

// ─── Core Intent Detection ───

export function detectIntent(message: string): DetectedIntent {
  // Check for data pastes FIRST — before any keyword triggers.
  // A pasted chart of accounts contains "account", "expense", "income" etc.
  // but is NOT a finance question and must NOT hit the QBO fast-path.
  if (isDataPaste(message)) {
    return { type: "chat" };
  }
  if (DIAGNOSTICS_TRIGGERS.test(message)) {
    return { type: "diagnostics" };
  }
  if (COST_TRIGGERS.test(message)) {
    return { type: "cost" };
  }
  if (PIPELINE_TRIGGERS.test(message)) {
    return { type: "pipeline" };
  }
  if (EMAIL_TRIGGERS.test(message)) {
    return { type: "email" };
  }
  if (INVENTORY_TRIGGERS.test(message)) {
    return { type: "inventory" };
  }
  if (REVENUE_TRIGGERS.test(message)) {
    return { type: "revenue" };
  }
  if (FINANCE_TRIGGERS.test(message)) {
    return { type: "finance" };
  }
  if (STRATEGY_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    return { type: "strategy", objective: message, department };
  }
  if (INITIATIVE_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    return { type: "initiative", department, goal: message };
  }
  if (SESSION_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    const sessionType = /review/i.test(message) ? "review" : "meeting";
    return { type: "session", department, sessionType };
  }
  return { type: "chat" };
}

// ─── Supplementary Intent Checks ───

export function isFinanceQuestion(message: string): boolean {
  // Data pastes must never be treated as finance questions — they contain
  // finance keywords in the data itself, not as user intent.
  if (isDataPaste(message)) return false;

  // Short directives like "option 2", "give me notion version", "build it",
  // "download", "give me csv" are follow-up commands, not finance questions.
  const isFollowUpCommand = /\b(option\s*\d|give me (the )?(notion|csv|excel|spreadsheet|download|export)|build it|compile it|finish it|finalize|download|export (it|this|that)|format (it|this|that))\b/i.test(message);
  if (isFollowUpCommand) return false;

  return /\b(finance|financial|revenue|margin|cogs|gross profit|profitability|aov|cash flow|budget|money|sales|orders|income|expenses|spending|p&l|profit|loss|chart of accounts|qbo|quickbooks|balance sheet|bank balance|cash position|vendor|supplier|tax|1099|reconcil|depreciation|amortization|equity|liabilities|inventory|burn rate|runway|breakeven|capital|transaction|general ledger|trial balance|bookkeep)\b/i.test(
    message,
  );
}

export function needsEmailExtractionSkill(message: string): boolean {
  return /\b(email|gmail|inbox|supplier|vendor|quote|invoice|freight|cogs|cost.*(per|unit|pound)|albanese|belmark|powers|dutch valley|bill thurner|greg kroetch|extract.*data|pull.*from.*email|find.*in.*email|check.*email|read.*email|production cost|packing fee|film cost)\b/i.test(
    message,
  );
}

export function needsDealCalculatorSkill(message: string): boolean {
  return /\b(deal|margin|pricing|wholesale price|price per unit|profit(ability)?|calculate.*deal|evaluate.*deal|should we take|quote.*price|how much.*make|unit economics|break.?even|channel.*comparison|faire.*margin|wholesale.*margin|distribution.*margin|negotiate.*price)\b/i.test(
    message,
  );
}

// ─── Competitor Intent Detection ───

export const KNOWN_COMPETITORS = [
  "haribo",
  "trolli",
  "albanese",
  "sour patch",
  "black forest",
  "welch",
  "smartsweets",
  "yumearth",
  "skittles",
];

export function isCompetitorQuestion(message: string): boolean {
  return /\b(competitor|competition|compete|vs\.?|pricing|promo|promotion|market share|positioning)\b/i.test(
    message,
  );
}

export function extractCompetitorHint(message: string): string | null {
  const lower = message.toLowerCase();
  for (const name of KNOWN_COMPETITORS) {
    if (lower.includes(name)) return name;
  }
  const vsMatch = lower.match(/\bvs\.?\s+([a-z0-9][a-z0-9\s-]{1,40})/i);
  if (vsMatch?.[1]) return vsMatch[1].trim();
  const compMatch = lower.match(/\bcompetitor\s+([a-z0-9][a-z0-9\s-]{1,40})/i);
  if (compMatch?.[1]) return compMatch[1].trim();
  return null;
}

export function inferCompetitorDataType(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(price|priced|pricing|\$|cost|cheaper|expensive)\b/.test(lower)) {
    return "pricing";
  }
  if (/\b(promo|promotion|discount|coupon|sale|deal)\b/.test(lower)) {
    return "promotion";
  }
  if (/\b(review|rating|stars?|feedback)\b/.test(lower)) {
    return "review";
  }
  if (/\b(launch|flavor|sku|pack|size|ingredient|formula|product)\b/.test(lower)) {
    return "product";
  }
  return "market_position";
}

export function shouldCaptureCompetitorIntel(message: string): boolean {
  if (!isCompetitorQuestion(message)) return false;
  if (message.trim().length < 20) return false;
  return /\b(saw|heard|noticed|offering|launched|running|selling|priced|discount|promo|review)\b/i.test(
    message,
  );
}
