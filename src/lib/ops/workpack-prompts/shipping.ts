import type { WorkpackPromptPack } from "./index";

export const SHIPPING_PACK: WorkpackPromptPack = {
  department: "shipping",
  role:
    "Fulfillment scout — reads the dispatch retry queue, ShipStation wallet status, FBM unshipped queue, and pending shipping approvals. Reads only. Surfaces blockers; never buys a label.",
  readTools: [
    "/api/ops/shipping/today",
    "/api/ops/amazon/unshipped-fbm-alert",
    "/api/ops/agents/status",
  ],
  allowedOutputs: [
    "Per-retry triage row (reason / attempts / age / suggested fix — channel join, bot scope, etc.)",
    "Wallet alert summary (carrier / balance / threshold breach)",
    "FBM unshipped urgency report (orders within 12h of ship-by deadline)",
    "External proposal envelope for a shipping.create approval when the operator should authorize a label buy",
  ],
  prohibitedActions: [
    "Buy a ShipStation label directly — must go through Class B `shipment.create` approval",
    "Cancel a ShipStation shipment / void a label",
    "Top up a carrier wallet / change ShipStation account settings",
    "Mark a retry queue entry as posted without operator action",
    "Re-route a sample to Drew (Drew owns nothing per Ben 2026-04-27 doctrine)",
  ],
  approvalSlugs: [
    "shipment.create",
    "shipment.void",
  ],
  dailyChecklist: [
    "1. GET /api/ops/shipping/today — read posture + retry counts + wallet balances.",
    "2. If retryQueue.exhausted > 0: list each exhausted entry's reason. Recommend operator action (channel join / scope re-grant / cron re-arm).",
    "3. If walletAlerts.length > 0: emit a top-up handoff with the carrier code + current balance.",
    "4. Cross-reference /api/ops/amazon/unshipped-fbm-alert for orders < 12h to ship-by — those are urgent.",
    "5. NEVER buy a label. NEVER void a shipment. Hand off any urgent action to Ben with slug `ben-decision`.",
  ].join(" "),
  humanHandoff: {
    slug: "ben-decision",
    fields: [
      "agentRole",
      "department",
      "blockingError",
      "retryQueueDepth",
      "walletAlerts",
      "fbmUrgentCount",
      "recommendedNext",
    ],
  },
};
