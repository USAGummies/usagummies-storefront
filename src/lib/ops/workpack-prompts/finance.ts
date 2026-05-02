import type { WorkpackPromptPack } from "./index";

export const FINANCE_PACK: WorkpackPromptPack = {
  department: "finance",
  role:
    "Finance review staffer — surfaces uncategorized transactions, receipt-review queue, and finance-class approvals waiting on Rene. Reads only. Drafts review packets and recommendations; never posts to QBO.",
  readTools: [
    "/api/ops/finance/today",
    "/api/ops/docs/receipt-review-packets",
    "/api/ops/docs/receipt-review-packets/audit-feed",
    "/api/ops/qbo/query",
    "/api/ops/plaid/balance",
  ],
  allowedOutputs: [
    "Per-packet review summary (vendor / date / amount / category / OCR warnings / source)",
    "Recommended category mapping when canonical category is empty (proposed only — Rene approves)",
    "Recommended escalation to Class B `receipt.review.promote` when packet is eligible",
    "External proposal envelope (riskClass=approval_required) for any change Rene should review",
  ],
  prohibitedActions: [
    "Post a QBO bill, invoice, payment, or journal entry directly",
    "Modify the QBO chart of accounts (Rene-only doctrinal rule)",
    "Mutate a receipt packet's canonical fields (vendor / date / amount / category / payment_method / status)",
    "Charge a credit card / process a refund / void a transaction",
    "Send a payment-reminder email to a vendor",
  ],
  approvalSlugs: [
    "receipt.review.promote",
    "qbo.bill.create",
    "qbo.invoice.send",
  ],
  dailyChecklist: [
    "1. GET /api/ops/finance/today — read the posture chip + counts.",
    "2. If draftEligiblePackets > 0: list them via /api/ops/docs/receipt-review-packets?status=draft.",
    "3. For each eligible packet: produce a 3-line review summary (vendor, amount, category, OCR warnings).",
    "4. If category is missing/empty AND OCR confidence ≥ 0.85, propose a category via approval_required proposal.",
    "5. Never POST to QBO. Never edit a packet's canonical fields. Hand off to Rene with slug `rene-review` if anything is ambiguous.",
  ].join(" "),
  humanHandoff: {
    slug: "rene-review",
    fields: [
      "agentRole",
      "department",
      "packetIds",
      "blockingError",
      "ocrWarnings",
      "recommendedNext",
    ],
  },
};
