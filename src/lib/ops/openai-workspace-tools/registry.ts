/**
 * OpenAI / ChatGPT workspace tool registry.
 *
 * This is a Phase 0 allowlist for exposing USA Gummies ops context to
 * ChatGPT custom connectors / MCP surfaces. It does NOT execute tools.
 * It classifies what ChatGPT may read, what it may only request approval
 * for, and what remains prohibited.
 */

export type WorkspaceToolMode = "read" | "approval_request" | "prohibited";

export type WorkspaceToolStatus = "ready" | "planned" | "blocked";

export type WorkspaceToolAudience = "Ben" | "Rene" | "Ben+Rene" | "Ops";

export interface OpenAIWorkspaceTool {
  id: string;
  name: string;
  description: string;
  mode: WorkspaceToolMode;
  status: WorkspaceToolStatus;
  audience: WorkspaceToolAudience;
  readOnly: boolean;
  requiresHumanApproval: boolean;
  backingRoute?: string;
  backingSurface?: string;
  approvalSlug?: string;
  blocker?: string;
  safetyNotes: readonly string[];
}

export interface OpenAIWorkspaceToolSummary {
  total: number;
  ready: number;
  planned: number;
  blocked: number;
  readOnly: number;
  approvalRequest: number;
  prohibited: number;
}

const READ_ONLY_NOTES = Object.freeze([
  "No mutation. ChatGPT may summarize, cite, and link back to the source surface.",
  "If a source is degraded or not wired, report that state explicitly; never convert it to zero.",
]);

const APPROVAL_NOTES = Object.freeze([
  "ChatGPT may prepare or request a Slack approval only.",
  "Execution remains inside the existing Slack approval closer and audit chain.",
  "No direct Gmail, QBO, ShipStation, Shopify, HubSpot stage, or Faire API write is allowed from ChatGPT.",
]);

const PROHIBITED_NOTES = Object.freeze([
  "No ChatGPT workspace connector path may execute this directly.",
  "Build a registered approval slug and tested closer first, or leave the action manual.",
]);

export const OPENAI_WORKSPACE_TOOLS: readonly OpenAIWorkspaceTool[] = Object.freeze([
  {
    id: "ops.sales.snapshot",
    name: "Sales command snapshot",
    description:
      "Read the current sales command center: revenue actions, Faire follow-ups, approvals, aging, and KPI context.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/sales",
    backingSurface: "/ops/sales",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.sales.day1-prospects",
    name: "Day 1 wholesale prospect playbook",
    description:
      "Read the curated Day 1 wholesale prospect list, including email-ready vs RangeMe/phone/manual-research buckets. Read-only; no sends, HubSpot writes, Apollo lookups, or synthetic emails.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/sales/prospects/day1",
    backingSurface: "/ops/sales/prospects/day1",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.sales.tour-playbook",
    name: "May 2026 sales-tour playbook",
    description:
      "Read the canonical May 2026 Ashford-to-Grand-Canyon sales-tour prospect contract, including route segments, vicinity tiers, verified/generic contact status, and research/call-task buckets. Read-only; no sends, HubSpot writes, Apollo lookups, or synthetic buyer data.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/sales/tour",
    backingSurface: "/ops/sales/tour",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.sales.stale-buyers",
    name: "Stale B2B buyer hit list",
    description:
      "Read the HubSpot-backed stale-buyer hit list used by the morning brief and Sales Command Center. Read-only; no outreach send, HubSpot write, or follow-up approval is opened.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/sales/stale-buyers",
    backingSurface: "/ops/sales",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.readiness.snapshot",
    name: "Ops readiness snapshot",
    description:
      "Read the boolean-only env and smoke-test readiness surface without exposing raw secret values.",
    mode: "read",
    status: "ready",
    audience: "Ops",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/readiness",
    backingSurface: "/ops/readiness",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.finance.review",
    name: "Finance review queue",
    description:
      "Read receipts, approvals, freight-comp, and AP packet review context for Rene/Ben.",
    mode: "read",
    status: "ready",
    audience: "Rene",
    readOnly: true,
    requiresHumanApproval: false,
    backingSurface: "/ops/finance/review",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.receipts.review-packets",
    name: "Receipt review packets",
    description:
      "Read OCR-backed receipt review packets and approval state. Suggestions remain distinct from canonical fields.",
    mode: "read",
    status: "ready",
    audience: "Rene",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/docs/receipt-review-packets",
    backingSurface: "/ops/finance/review-packets",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.faire.direct",
    name: "Faire Direct queue",
    description:
      "Read Faire Direct invite, sent, and follow-up queues. ChatGPT may summarize but not send.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/faire/direct-invites",
    backingSurface: "/ops/faire-direct",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.agent.packs",
    name: "Agent packs",
    description:
      "Read the operator-facing pack view over existing agent contracts. Packs are read-models, not new agents. Includes ghost-registry warning, P0 status mirror, drift summary, lockstep summary, and discipline-invariants badge.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/agents/packs/snapshot",
    backingSurface: "/ops/agents/packs",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "ops.operating-memory.search",
    name: "Operating memory search",
    description:
      "Search captured doctrine, corrections, transcripts, decisions, and follow-ups in the P0-3 transcript-saver store. Bodies are already redacted at ingest. Filter by kind via ?kind= query param (correction|decision|followup|transcript|report); ?limit= caps result count.",
    mode: "read",
    status: "ready",
    audience: "Ben",
    readOnly: true,
    requiresHumanApproval: false,
    backingRoute: "/api/ops/operating-memory/recent",
    // No UI page yet — point at the JSON route so connector docs validate.
    backingSurface: "/api/ops/operating-memory/recent",
    safetyNotes: READ_ONLY_NOTES,
  },
  {
    id: "faire.direct.invite.request-approval",
    name: "Request Faire Direct invite approval",
    description:
      "Prepare a Class B Slack approval for an already-approved Faire Direct invite candidate.",
    mode: "approval_request",
    status: "ready",
    audience: "Ben",
    readOnly: false,
    requiresHumanApproval: true,
    approvalSlug: "faire-direct.invite",
    backingRoute: "/api/ops/faire/direct-invites/[id]/request-approval",
    backingSurface: "/ops/faire-direct",
    safetyNotes: APPROVAL_NOTES,
  },
  {
    id: "faire.direct.follow-up.request-approval",
    name: "Request Faire Direct follow-up approval",
    description:
      "Prepare a Class B Slack approval for a due or overdue Faire Direct follow-up.",
    mode: "approval_request",
    status: "ready",
    audience: "Ben",
    readOnly: false,
    requiresHumanApproval: true,
    approvalSlug: "faire-direct.follow-up",
    backingRoute: "/api/ops/faire/direct-invites/[id]/follow-up/request-approval",
    backingSurface: "/ops/faire-direct",
    safetyNotes: APPROVAL_NOTES,
  },
  {
    id: "receipt.review.promote.request-approval",
    name: "Request receipt review approval",
    description:
      "Prepare Rene's receipt review approval packet. It never creates QBO bills or mutates canonical receipt fields.",
    mode: "approval_request",
    status: "ready",
    audience: "Rene",
    readOnly: false,
    requiresHumanApproval: true,
    approvalSlug: "receipt.review.promote",
    backingRoute: "/api/ops/docs/receipt/promote-review",
    backingSurface: "/ops/finance/review",
    safetyNotes: APPROVAL_NOTES,
  },
  {
    id: "qbo.bill.create.from-receipt.direct",
    name: "Direct QBO bill create from receipt",
    description:
      "Prohibited for ChatGPT workspace agents until Rene's chart-of-accounts mapping and Class C closer are registered.",
    mode: "prohibited",
    status: "blocked",
    audience: "Ben+Rene",
    readOnly: false,
    requiresHumanApproval: true,
    blocker:
      "QBO bill creation is parked pending Rene's vendor/account/class mapping and an explicit Class C approval slug.",
    safetyNotes: PROHIBITED_NOTES,
  },
  {
    id: "shipping.buy-label.direct",
    name: "Direct label purchase",
    description:
      "Prohibited for ChatGPT workspace agents. Label purchases must remain in the existing dispatch/approval flow.",
    mode: "prohibited",
    status: "blocked",
    audience: "Ops",
    readOnly: false,
    requiresHumanApproval: true,
    blocker:
      "Buying labels is a shipping/customer-facing action; ChatGPT may summarize queues but not purchase labels.",
    safetyNotes: PROHIBITED_NOTES,
  },
]);

export function listOpenAIWorkspaceTools(): readonly OpenAIWorkspaceTool[] {
  return OPENAI_WORKSPACE_TOOLS;
}

export function getOpenAIWorkspaceTool(
  id: string,
): OpenAIWorkspaceTool | undefined {
  return OPENAI_WORKSPACE_TOOLS.find((tool) => tool.id === id);
}

export function summarizeOpenAIWorkspaceTools(
  tools: readonly OpenAIWorkspaceTool[] = OPENAI_WORKSPACE_TOOLS,
): OpenAIWorkspaceToolSummary {
  return {
    total: tools.length,
    ready: tools.filter((tool) => tool.status === "ready").length,
    planned: tools.filter((tool) => tool.status === "planned").length,
    blocked: tools.filter((tool) => tool.status === "blocked").length,
    readOnly: tools.filter((tool) => tool.mode === "read").length,
    approvalRequest: tools.filter((tool) => tool.mode === "approval_request").length,
    prohibited: tools.filter((tool) => tool.mode === "prohibited").length,
  };
}

export function connectorSearchDocuments(
  tools: readonly OpenAIWorkspaceTool[] = OPENAI_WORKSPACE_TOOLS,
): Array<{ id: string; title: string; url: string; text: string }> {
  return tools.map((tool) => ({
    id: tool.id,
    title: tool.name,
    url: tool.backingSurface ?? tool.backingRoute ?? `/ops/openai-workspace-tools#${tool.id}`,
    text: [
      tool.description,
      `Mode: ${tool.mode}.`,
      `Status: ${tool.status}.`,
      `Read-only: ${String(tool.readOnly)}.`,
      tool.approvalSlug ? `Approval slug: ${tool.approvalSlug}.` : null,
      tool.blocker ? `Blocker: ${tool.blocker}.` : null,
      ...tool.safetyNotes,
    ]
      .filter(Boolean)
      .join("\n"),
  }));
}
