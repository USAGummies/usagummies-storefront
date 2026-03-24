/**
 * abra-policy.ts — Unified approval policy for Abra AI operations assistant
 *
 * Single source of truth for every action type's execution tier, risk floor,
 * daily limits, amount caps, and approval ownership. Replaces:
 *   - AUTO_EXEC_POLICIES array in abra-actions.ts
 *   - DIRECT_EXEC_ACTIONS set in abra-actions.ts
 *   - EXTERNAL_SUBMISSION_ACTIONS set in abra-actions.ts
 *   - ELEVATED_RISK_ACTIONS set in normalizeActionDirective (abra-actions.ts)
 *
 * Usage: import helpers from this file; abra-actions.ts will delegate to them
 * in a later refactor pass.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PolicyTier = "direct" | "auto_with_audit" | "approval_required";
export type ApprovalOwner = "ben" | "rene" | "any_admin";

export type ActionPolicy = {
  /** Execution tier — how the action is handled without extra runtime context. */
  tier: PolicyTier;
  /**
   * Minimum risk level this action is ever allowed to carry.
   * If Claude labels the action below this floor, it is silently bumped up.
   * Mirrors the old ELEVATED_RISK_ACTIONS logic.
   */
  riskFloor: RiskLevel;
  /** Max auto-executions of this action type per calendar day (UTC). */
  dailyLimit: number;
  /**
   * Optional hard cap on the monetary value of the operation.
   * For record_transaction / categorize_qbo_transaction: absolute dollar amount.
   * For update_shopify_inventory: absolute unit delta.
   * Exceeding this cap forces tier → "approval_required" at runtime.
   */
  maxAmount?: number;
  /**
   * Who must approve when tier === "approval_required" or a runtime cap is hit.
   * Omitted for "direct" tier actions (no approval flow needed).
   */
  approvalOwner?: ApprovalOwner;
  /** Human-readable description of why this policy exists. */
  description: string;
};

// ---------------------------------------------------------------------------
// Policy map
// ---------------------------------------------------------------------------

/**
 * ACTION_POLICIES — one entry per registered action type.
 *
 * Tiers:
 *   "direct"           — execute immediately, write NO approval row, NO audit log.
 *                        Reserved for read-only operations.
 *   "auto_with_audit"  — execute immediately AND write a decision_log row with
 *                        status = "auto_approved". For low-risk internal writes.
 *   "approval_required"— create an approvals row (status = "pending"), notify the
 *                        approvalOwner via Slack, and wait for human decision.
 */
export const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // -------------------------------------------------------------------------
  // READ-ONLY — direct exec, no approval row, no audit log
  // -------------------------------------------------------------------------

  read_email: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 100,
    description: "Read email messages from Gmail — read-only, zero side-effects.",
  },

  search_email: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 60,
    description: "Search email via Gmail API — read-only, zero side-effects.",
  },

  query_ledger: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 100,
    description: "Query Notion financial ledger — read-only.",
  },

  query_kpi: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 100,
    description: "Query KPI timeseries for specific dates — read-only.",
  },

  // create_qbo_bill defined below in QBO write section

  amazon_update_price: {
    tier: "approval_required",
    riskFloor: "high",
    dailyLimit: 5,
    description: "Update Amazon listing price via SP-API. Always requires approval.",
  },

  amazon_update_ppc: {
    tier: "approval_required",
    riskFloor: "high",
    dailyLimit: 10,
    description: "Adjust Amazon PPC bids/budgets. Always requires approval.",
  },

  query_qbo: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 100,
    description: "Query QuickBooks Online — read-only API calls.",
  },

  qbo_setup_assessment: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 20,
    description: "Assess QBO setup completeness using read-only QBO and categorization preview data.",
  },

  // search_brain: removed — no handler exists. Brain search is automatic via tiered context.

  generate_file: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 20,
    description: "Generate and upload spreadsheet/CSV files to Slack channels.",
  },

  query_shopify_orders: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 60,
    description: "Query Shopify orders via Admin API — read-only.",
  },

  calculate_deal: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 100,
    description: "Calculate deal margins and profitability — pure read-only computation.",
  },

  run_scenario: {
    tier: "direct",
    riskFloor: "low",
    dailyLimit: 20,
    description:
      "Run a what-if financial scenario calculation — pure computation, no writes.",
  },

  // -------------------------------------------------------------------------
  // INTERNAL WRITES — auto_with_audit (exec + decision_log row)
  // -------------------------------------------------------------------------

  create_brain_entry: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 50,
    description: "Write a new fact/memory to Abra's open brain entries.",
  },

  // update_brain_entry, store_brain_entry: removed — no handlers. Use create_brain_entry instead.

  acknowledge_signal: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 30,
    description: "Mark a signal as acknowledged — lightweight internal state update.",
  },

  create_task: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 20,
    description: "Create a task in the ops platform — internal project management.",
  },

  // log_metric: removed — no handler. KPIs recorded via kpi-collector, not LLM actions.

  log_production_run: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 10,
    description: "Record a production run in the supply chain ledger.",
  },

  record_vendor_quote: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 20,
    description: "Record a vendor quote — no money moves, informational only.",
  },

  reconcile_transactions: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 10,
    description: "Reconcile Shopify / QBO transactions — read + internal annotation.",
  },

  pause_initiative: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 10,
    description: "Pause a tracked initiative — internal state flag, no external effect.",
  },

  update_notion: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 30,
    description: "Update an existing Notion page property — internal ops record.",
  },

  create_notion_page: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 15,
    description:
      "Create a Notion page. Finance-tagged pages are escalated to approval_required at runtime.",
  },

  categorize_qbo_transaction: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 50,
    maxAmount: 5000,
    description:
      "Categorize a single QBO bank feed transaction. Transactions > $5 000 require human review.",
  },

  // -------------------------------------------------------------------------
  // APPROVAL REQUIRED — write approvals row, notify owner, wait for decision
  // -------------------------------------------------------------------------

  send_email: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "ben",
    description: "Send an outbound email — external communication, always requires approval.",
  },

  draft_email_reply: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 20,
    approvalOwner: "ben",
    description:
      "Draft a reply and post to Slack for review before sending — gate IS the draft review.",
  },

  send_slack: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 20,
    approvalOwner: "ben",
    description:
      "Send a Slack message to an external-facing channel — requires approval. " +
      "Internal #abra-log posts may be downgraded to auto_with_audit at runtime.",
  },

  record_transaction: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 20,
    maxAmount: 500,
    approvalOwner: "rene",
    description:
      "Record a financial transaction in the ledger. " +
      "Transactions ≤ $500 may be auto-approved at runtime if the global flag is on; " +
      "amounts > $500 always require Rene's approval.",
  },

  batch_categorize_qbo: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 5,
    approvalOwner: "rene",
    description:
      "Bulk-categorize multiple QBO transactions in one pass — high financial impact, Rene approves.",
  },

  create_qbo_invoice: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "rene",
    description: "Create a QBO invoice — triggers a real AR entry, Rene approves.",
  },

  create_qbo_vendor: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 20,
    approvalOwner: "any_admin",
    description: "Create a vendor in QBO — low risk, auto-executes for low risk.",
  },

  create_qbo_account: {
    tier: "approval_required",
    riskFloor: "low",
    dailyLimit: 20,
    approvalOwner: "rene",
    description: "Create an account in QBO chart of accounts — Rene approves structure changes.",
  },

  create_qbo_customer: {
    tier: "auto_with_audit",
    riskFloor: "low",
    dailyLimit: 20,
    approvalOwner: "any_admin",
    description: "Create a customer in QBO — low risk, auto-executes.",
  },

  create_qbo_bill: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "rene",
    description: "Create a bill (AP entry) in QBO — financial impact, Rene approves.",
  },

  run_monthly_close: {
    tier: "approval_required",
    riskFloor: "high",
    dailyLimit: 2,
    approvalOwner: "rene",
    description:
      "Execute the end-of-month financial close process — high impact, Rene must approve.",
  },

  update_shopify_inventory: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    maxAmount: 500, // max absolute unit adjustment before requiring human review
    approvalOwner: "ben",
    description:
      "Adjust Shopify inventory levels. Adjustments ≤ 500 units may be auto-executed if " +
      "global flag is on; larger adjustments always require approval.",
  },

  create_shopify_discount: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 5,
    approvalOwner: "ben",
    description: "Create a Shopify discount code or automatic discount — Ben approves.",
  },

  create_wholesale_draft_order: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "ben",
    description: "Create a wholesale draft order in Shopify — external-facing, Ben approves.",
  },

  create_shopify_product_draft: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 5,
    approvalOwner: "ben",
    description:
      "Create a new Shopify product draft — catalog change, Ben reviews before publishing.",
  },

  correct_claim: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "ben",
    description:
      "Override a fact in the HOT memory tier — high data-integrity risk. " +
      "Always requires explicit approval; auto-exec is permanently disabled.",
  },

  start_workflow: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "ben",
    description: "Start a multi-step workflow — may trigger external side-effects.",
  },

  resume_workflow: {
    tier: "approval_required",
    riskFloor: "medium",
    dailyLimit: 10,
    approvalOwner: "ben",
    description: "Resume a paused workflow — re-enables external side-effects.",
  },
};

// ---------------------------------------------------------------------------
// Safe default (returned for unknown action types)
// ---------------------------------------------------------------------------

const SAFE_DEFAULT_POLICY: ActionPolicy = {
  tier: "approval_required",
  riskFloor: "medium",
  dailyLimit: 5,
  approvalOwner: "any_admin",
  description: "Unknown action type — conservative default requires approval.",
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Normalise an action type string for lookup (trim + lowercase). */
function normalise(actionType: string): string {
  return String(actionType || "").trim().toLowerCase();
}

/**
 * Return the full policy for an action type.
 * Falls back to the safe conservative default for unrecognised types.
 */
export function getPolicy(actionType: string): ActionPolicy {
  return ACTION_POLICIES[normalise(actionType)] ?? SAFE_DEFAULT_POLICY;
}

/**
 * Return the policy tier without loading the full policy object.
 */
export function getPolicyTier(actionType: string): PolicyTier {
  return getPolicy(actionType).tier;
}

/**
 * True when the action executes directly — no approval row, no audit log.
 * Intended only for read-only operations.
 */
export function canDirectExec(actionType: string): boolean {
  return getPolicy(actionType).tier === "direct";
}

/**
 * True when the action can be auto-executed (with an audit log entry).
 *
 * Optional runtime checks:
 *   riskLevel — if provided, the action's runtime risk must not exceed the
 *               policy's riskFloor (auto_with_audit actions are expected to stay "low").
 *
 * Note: this does NOT check the daily-count limit or global kill-switch — those
 * require async Supabase access and remain in abra-actions.ts (canAutoExecute).
 */
export function canAutoExec(actionType: string, riskLevel?: RiskLevel): boolean {
  const policy = getPolicy(actionType);
  if (policy.tier !== "auto_with_audit") return false;

  if (riskLevel) {
    const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    // Block auto-exec if the runtime risk level exceeds the policy floor
    if (rank[riskLevel] > rank[policy.riskFloor]) return false;
  }

  return true;
}

/**
 * True when the action must go through the full approval flow.
 *
 * Runtime escalation rules applied here:
 *   • Any action with riskLevel "high" or "critical" is always escalated.
 *   • Financial actions with amount > maxAmount are always escalated.
 */
export function requiresApproval(
  actionType: string,
  riskLevel?: RiskLevel,
  amount?: number,
): boolean {
  const policy = getPolicy(actionType);

  // Explicit approval_required tier
  if (policy.tier === "approval_required") return true;

  // Runtime escalation — high/critical risk
  if (riskLevel === "high" || riskLevel === "critical") return true;

  // Runtime escalation — amount cap exceeded
  if (
    typeof policy.maxAmount === "number" &&
    typeof amount === "number" &&
    Math.abs(amount) > policy.maxAmount
  ) {
    return true;
  }

  return false;
}

/**
 * Return the approval owner for an action type.
 *
 * Routing logic (in priority order):
 *   1. Finance-tagged actions → "rene"
 *   2. External-comms and founder-exec actions → "ben"
 *   3. Critical risk → "any_admin" (posts to shared channel for visibility)
 *   4. Policy-defined approvalOwner (for everything else)
 *   5. Safe fallback → "any_admin"
 */
export function getApprovalOwner(
  actionType: string,
  riskLevel?: RiskLevel,
): ApprovalOwner {
  const key = normalise(actionType);

  // 1. Finance-tagged → Rene
  const FINANCE_ACTIONS = new Set([
    "record_transaction",
    "batch_categorize_qbo",
    "run_monthly_close",
    "create_qbo_invoice",
  ]);
  if (FINANCE_ACTIONS.has(key)) return "rene";

  // 2. External comms & founder-exec → Ben
  const BEN_ACTIONS = new Set([
    "send_email",
    "draft_email_reply",
    "send_slack",
    "create_shopify_discount",
    "update_shopify_inventory",
    "create_wholesale_draft_order",
    "create_shopify_product_draft",
    "correct_claim",
    "start_workflow",
    "resume_workflow",
  ]);
  if (BEN_ACTIONS.has(key)) return "ben";

  // 3. Critical risk → any_admin (broadcast to shared channel)
  if (riskLevel === "critical") return "any_admin";

  // 4. Policy-defined owner
  const policy = getPolicy(actionType);
  if (policy.approvalOwner) return policy.approvalOwner;

  // 5. Safe fallback
  return "any_admin";
}

/**
 * Resolve an ApprovalOwner to their Slack user ID for DM-based approval pings.
 * Returns null if the env var is not configured (caller should fall back to
 * posting to the shared approvals channel).
 *
 * Env vars:
 *   SLACK_USER_BEN   — Ben's Slack member ID  (e.g. "U01ABCDEF")
 *   SLACK_USER_RENE  — Rene's Slack member ID (e.g. "U02XYZABC")
 */
export function getOwnerSlackId(owner: ApprovalOwner): string | null {
  switch (owner) {
    case "ben":
      return process.env.SLACK_USER_BEN?.trim() || null;
    case "rene":
      return process.env.SLACK_USER_RENE?.trim() || null;
    case "any_admin":
      // "any_admin" means post to the shared approvals channel — no single DM target
      return null;
  }
}

/**
 * Clamp a runtime risk level up to the policy's riskFloor if it would
 * otherwise be lower. Mirrors the ELEVATED_RISK_ACTIONS logic that was
 * previously embedded in normalizeActionDirective.
 *
 * Example: record_transaction with Claude-supplied risk "low" → bumped to "medium".
 */
export function clampRiskLevel(actionType: string, rawRisk: RiskLevel): RiskLevel {
  const policy = getPolicy(actionType);
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  if (rank[rawRisk] < rank[policy.riskFloor]) return policy.riskFloor;
  return rawRisk;
}
