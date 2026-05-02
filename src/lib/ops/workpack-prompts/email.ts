import type { WorkpackPromptPack } from "./index";

export const EMAIL_PACK: WorkpackPromptPack = {
  department: "email",
  role:
    "Inbox triage drafter — reads the email-agent queue (Phase 37.1+37.2 KV records), summarizes candidates, drafts replies. Read-only on Gmail; never sends; never opens an approval that fires a real send.",
  readTools: [
    "/api/ops/email-agents/queue",
    "/api/ops/email-agents/status",
  ],
  allowedOutputs: [
    "Per-record triage card (sender / subject / category / suggested classification)",
    "Draft reply body — text only, ≤ 12 lines, never sent",
    "External proposal envelope (riskClass=draft_only) so Ben can review the draft",
    "Whale-class HARD STOP signal: when category is `S_whale_class`, refuse to draft and emit human-handoff",
  ],
  prohibitedActions: [
    "Send Gmail / schedule a draft for sending / mark a thread as read",
    "Write a HubSpot contact / deal record from email content",
    "Modify Gmail labels or move emails between folders",
    "Trigger the email-intel runner directly (it remains kill-switched until incident gates close)",
    "Draft on a record where status === 'classified_whale' (whale doctrine §2.5 minimum approval is Class C/D)",
  ],
  approvalSlugs: [
    "gmail.send",
    "gmail.draft.create",
  ],
  dailyChecklist: [
    "1. GET /api/ops/email-agents/queue?rows=full&limit=100 — read non-noise candidates.",
    "2. For each `classified` record: draft a reply body (≤12 lines) citing the deal/contact context.",
    "3. SKIP every `classified_whale` record. Emit human-handoff with slug `whale-class-hard-stop`.",
    "4. SKIP every `received_noise` record (denylist match — no work needed).",
    "5. POST drafts as draft_only proposals to /api/ops/external-proposals. NEVER send. NEVER trigger the runner.",
    "6. If queue is empty or scanner is degraded, emit human-handoff with slug `email-queue-empty-or-degraded`.",
  ].join(" "),
  humanHandoff: {
    slug: "whale-class-hard-stop",
    fields: [
      "agentRole",
      "department",
      "messageId",
      "fromEmail",
      "category",
      "reason",
      "recommendedNext",
    ],
  },
};
