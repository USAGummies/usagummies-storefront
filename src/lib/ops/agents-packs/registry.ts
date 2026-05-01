/**
 * Agent Packs registry — read-model groupings over the existing 21
 * agent contracts in `/contracts/agents/` + `viktor.md` + the meta
 * `interviewer.md`.
 *
 * Implements P0-2 from `/contracts/agent-architecture-audit.md`.
 *
 * **What this is NOT:**
 *   - NOT a new division (divisions live in `/contracts/divisions.json`).
 *   - NOT a new approval slug (slugs live in `/contracts/approval-taxonomy.md`).
 *   - NOT a new agent (no agent on this page exists outside its
 *     existing contract; the `id` field always points to a shipped
 *     `/contracts/agents/<slug>.md`).
 *   - NOT a resurrection of the retired 70-agent registry. The
 *     `engine-schedule.ts` stub stays empty; this module is its
 *     replacement read-surface, sourced from contracts.
 *
 * **What it IS:**
 *   - A static, typed mapping from existing contracts to 6 dashboard
 *     packs (audience-shaped read-models). Adding a pack here does
 *     NOT activate anything — it's a UI cross-cut.
 *
 * **Drew-owns-nothing discipline:**
 *   - No `humanOwner: "Drew"` entry in this registry.
 *   - Sample/Order Dispatch retains Drew as a *fulfillment node* for
 *     the East Coast samples lane; that's a routing fact, not an
 *     ownership lane. The contract's primary `humanOwner` is Ben.
 */

import type { DivisionId, HumanOwner } from "@/lib/ops/control-plane/types";
import type { HeartbeatOutputState } from "@/lib/ops/agent-heartbeat/types";

/**
 * Lifecycle of an agent in dashboard view.
 *
 * - `live`     — runtime is wired AND the agent runs on cadence today.
 * - `partial`  — runtime is wired but degraded (missing token, fallback
 *                mode, only some workflows live, etc.). Specific
 *                blocker recorded in `blocker`.
 * - `latent`   — contract exists, no runtime wired. Awaiting external
 *                tool decision or scheduled wiring.
 * - `blocked`  — runtime exists but all paths gated by an external
 *                blocker (token, schema, third-party access).
 * - `disabled` — explicitly disabled stub (the `engine-schedule.ts` /
 *                `engine-runner.ts` ghost). No agent should be in this
 *                state today; the field exists so the UI can flag
 *                regressions.
 */
export type AgentLifecycle =
  | "live"
  | "partial"
  | "latent"
  | "blocked"
  | "disabled";

export type PackId =
  | "b2b-revenue"
  | "executive-control"
  | "finance-cash"
  | "ops-fulfillment"
  | "system-build"
  | "research-growth";

export interface AgentEntry {
  /**
   * Stable id — matches the slug of `/contracts/agents/<id>.md` (or
   * `viktor` for the top-level Viktor contract). Used as the React
   * key + the link target.
   */
  id: string;
  /** Display name. */
  name: string;
  /** Path to canonical contract (relative to repo root). */
  contractPath: string;
  /** Division id (must be a DivisionId from control-plane/types). */
  division: DivisionId;
  /** Primary human owner. NEVER "Drew". */
  humanOwner: HumanOwner;
  /** One-line role description, suitable for a card. */
  role: string;
  /** Current lifecycle. */
  lifecycle: AgentLifecycle;
  /**
   * Approval slugs the agent emits (Class A/B/C). Every slug here MUST
   * resolve to a registered slug in `taxonomy.ts` — the test suite
   * locks this. Empty array if the agent emits nothing (pure
   * observer / pre-build / library).
   */
  approvalSlugs: readonly string[];
  /** Optional runtime path — file or route the runtime lives at. */
  runtimePath?: string;
  /** Optional blocker description for `partial` / `blocked` lifecycle. */
  blocker?: string;
  /** Optional Slack channel the agent posts to (display only). */
  channel?: string;
}

export type AgentHeartbeatCadenceKind = "cron" | "event" | "manual" | "latent";

export interface AgentHeartbeatMetadata {
  cadence: AgentHeartbeatCadenceKind;
  schedule: string;
  queueSource: string;
  outputStates: readonly HeartbeatOutputState[];
  budget: {
    monthlyUsdLimit: number | null;
    maxRunsPerDay: number | null;
  };
  nextPhase?: string;
}

export interface PackDef {
  id: PackId;
  name: string;
  audience: string;
  /** One-paragraph description of what this read-model surfaces. */
  description: string;
  /** Default human owner (the person who'd open this pack daily). */
  primaryOwner: HumanOwner;
  /** Member agent ids (must match `AgentEntry.id`). */
  memberIds: readonly string[];
}

/**
 * Static agent registry. One entry per shipped contract or shipped P0
 * library. Hand-maintained; the weekly drift audit catches drift
 * between this and `/contracts/agents/`.
 *
 * Lifecycle reflects current runtime reality as of 2026-04-29:
 *   - `live`     — the runtime is wired and active today.
 *   - `partial`  — runtime exists but a blocker is recorded.
 *   - `latent`   — contract exists, no runtime yet.
 *
 * Update this table when an agent's runtime status changes. The
 * dashboard reflects this table; do NOT edit the contracts in lockstep
 * here — that's the weekly drift audit's job.
 */
export const AGENT_REGISTRY: readonly AgentEntry[] = Object.freeze([
  // --- Sales / B2B ----------------------------------------------------
  {
    id: "viktor",
    name: "Viktor",
    contractPath: "contracts/viktor.md",
    division: "sales",
    humanOwner: "Ben",
    role: "Slack-native sales agent — Q&A, HubSpot hygiene, outreach drafts (per-send Class B)",
    lifecycle: "live",
    approvalSlugs: [
      "system.read",
      "draft.email",
      "internal.note",
      "slack.post.audit",
      "hubspot.task.create",
      "gmail.send",
      "hubspot.deal.stage.move",
    ],
    runtimePath: "viktor admin panel + W-1..W-8 workflows",
    channel: "#sales / #ops-approvals",
  },
  {
    id: "faire-specialist",
    name: "Faire Specialist (S-12)",
    contractPath: "contracts/agents/faire-specialist.md",
    division: "sales",
    humanOwner: "Ben",
    role: "Faire Direct invites + marketplace orders + payout pre-work",
    lifecycle: "partial",
    blocker: "FAIRE_ACCESS_TOKEN reads are degraded; Direct invite send path is live",
    approvalSlugs: [
      "system.read",
      "open-brain.capture",
      "slack.post.audit",
      "internal.note",
      "faire-direct.invite",
      "faire-direct.follow-up",
      "gmail.send",
    ],
    runtimePath: "/api/ops/faire-specialist + /ops/faire-direct",
    channel: "#sales",
  },
  {
    id: "b2b-revenue-watcher",
    name: "B2B Revenue Watcher",
    contractPath: "contracts/agents/b2b-revenue-watcher.md",
    division: "sales",
    humanOwner: "Ben",
    role: "Read-only heartbeat over stale buyers, Faire follow-ups, approvals, and wholesale inquiries",
    lifecycle: "partial",
    blocker: "Dry-run route is live; no cron or audit persistence until cadence is approved",
    approvalSlugs: ["system.read"],
    runtimePath: "/api/ops/agents/b2b-revenue-watcher/run",
    channel: "/ops/sales + OpenAI workspace tool",
  },
  {
    id: "viktor-rene-capture",
    name: "Viktor W-7 — Rene Response Capture",
    contractPath: "contracts/agents/viktor-rene-capture.md",
    division: "financials",
    humanOwner: "Rene",
    role: "Durably log Rene's #finance decision-queue replies (R/J/CF/D/APPROVED/REDLINE)",
    lifecycle: "live",
    approvalSlugs: ["system.read", "open-brain.capture", "slack.post.audit"],
    runtimePath: "src/app/api/ops/viktor/rene-capture/route.ts",
    channel: "#finance",
  },

  // --- Executive Control ---------------------------------------------
  {
    id: "executive-brief",
    name: "Executive Brief Specialist (S-23)",
    contractPath: "contracts/agents/executive-brief.md",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Compose + publish morning + EOD briefs (weekday 8 AM / 5 PM PT)",
    lifecycle: "live",
    approvalSlugs: ["system.read", "brief.publish", "slack.post.audit"],
    runtimePath: "src/app/api/ops/daily-brief/route.ts",
    channel: "#ops-daily",
  },
  {
    id: "drift-audit-runner",
    name: "Drift-Audit Runner (S-25)",
    contractPath: "contracts/agents/drift-audit-runner.md",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Sunday weekly drift audit — sample 10 outputs, score correctness, auto-pause ≥2 violations",
    lifecycle: "live",
    approvalSlugs: ["system.read", "audit.sample.score", "slack.post.audit"],
    runtimePath: "src/app/api/ops/control-plane/drift-audit/route.ts",
    channel: "#ops-audit",
  },
  {
    id: "compliance-specialist",
    name: "Compliance Specialist (S-14)",
    contractPath: "contracts/agents/compliance-specialist.md",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Compliance calendar — COIs, W-9s, FDA FFR, USPTO §8/§9, Approved Claims gate",
    lifecycle: "partial",
    blocker: "Notion compliance DB pending; runs in fallback mode using in-repo registry",
    approvalSlugs: [
      "system.read",
      "coi.expiry-alert",
      "slack.post.audit",
      "internal.note",
      "approved-claims.add",
      "approved-claims.retire",
      "legal.doc.expiry-override",
      "claim.counsel-review.request",
    ],
    channel: "#ops-alerts",
  },
  {
    id: "interviewer",
    name: "Interviewer (pre-build spec)",
    contractPath: "contracts/agents/interviewer.md",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Pre-build spec disambiguation — 3-5 questions with named defaults",
    lifecycle: "live",
    // Meta agent — emits no taxonomy slugs; produces a spec document only.
    approvalSlugs: [],
    runtimePath: "(pre-build pass; runs inside Claude Code session)",
  },
  {
    id: "transcript-saver",
    name: "Operating-Memory Transcript Saver (P0-3)",
    contractPath: "contracts/agent-architecture-audit.md#p0-3",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Capture corrections / decisions / transcripts to operating memory with provenance + dedupe",
    lifecycle: "live",
    approvalSlugs: ["open-brain.capture"],
    runtimePath: "src/app/api/ops/transcript/capture/route.ts",
    channel: "#ops-audit",
  },
  {
    id: "slack-corrections-drift-detector",
    name: "Slack-Corrections Drift Detector (P0-1)",
    contractPath: "contracts/agent-architecture-audit.md#p0-1",
    division: "executive-control",
    humanOwner: "Ben",
    role: "Read operating-memory entries, run 5 detectors, emit drift report (observation-only)",
    lifecycle: "live",
    // Pure observer — no taxonomy slugs emitted.
    approvalSlugs: [],
    runtimePath: "src/app/api/ops/operating-memory/drift/route.ts",
    channel: "(read-only API)",
  },

  // --- Finance / Cash -------------------------------------------------
  {
    id: "booke",
    name: "Booke (third-party)",
    contractPath: "contracts/agents/booke.md",
    division: "financials",
    humanOwner: "Rene",
    role: "Auto-categorize bank transactions in QBO; flag anomalies (≥0.95 conf auto, <0.95 to Rene)",
    lifecycle: "live",
    approvalSlugs: [
      "system.read",
      "booke.categorize.suggest",
      "booke.categorize.edit",
    ],
    runtimePath: "Booke AI (third-party SaaS)",
    channel: "#finance",
  },
  {
    id: "finance-exception",
    name: "Finance Exception Agent",
    contractPath: "contracts/agents/finance-exception.md",
    division: "financials",
    humanOwner: "Rene",
    role: "Daily Rene-ready finance digest + route exceptions to #finance",
    lifecycle: "live",
    approvalSlugs: [
      "system.read",
      "brief.publish",
      "slack.post.audit",
      "internal.note",
    ],
    runtimePath: "src/app/api/ops/finance + cron",
    channel: "#finance",
  },
  {
    id: "reconciliation-specialist",
    name: "Reconciliation Specialist (S-06)",
    contractPath: "contracts/agents/reconciliation-specialist.md",
    division: "financials",
    humanOwner: "Rene",
    role: "Daily Plaid↔QBO match; weekly Amazon/Shopify/Faire payout pre-work for Rene's manual posting",
    lifecycle: "partial",
    blocker: "Manual Rene posting; staging routes exist but auto-flagging cadence not yet pinned",
    approvalSlugs: [
      "system.read",
      "open-brain.capture",
      "slack.post.audit",
      "internal.note",
    ],
    runtimePath: "src/app/api/ops/reconciliation/* + Make.com staging",
    channel: "#finance",
  },

  // --- Ops / Fulfillment ---------------------------------------------
  {
    id: "ops",
    name: "Operations Agent",
    contractPath: "contracts/agents/ops.md",
    division: "production-supply-chain",
    humanOwner: "Ben",
    role: "Vendor + PO + shipping coordination, sample watcher, inventory thresholds",
    lifecycle: "live",
    approvalSlugs: [
      "system.read",
      "internal.note",
      "slack.post.audit",
      "qbo.po.draft",
      "shipstation.rule.modify",
      "vendor.master.create",
    ],
    runtimePath: "src/app/api/ops/* (multiple routes)",
    channel: "#operations",
  },
  {
    id: "inventory-specialist",
    name: "Inventory Specialist (S-07)",
    contractPath: "contracts/agents/inventory-specialist.md",
    division: "production-supply-chain",
    humanOwner: "Ben",
    role: "Shopify ATP accuracy, cover-day forecast, production-run proposals (Class C dual: Ben+Rene)",
    lifecycle: "partial",
    blocker: "Cover-day forecast wired; cycle-count delta surfacing pending",
    approvalSlugs: [
      "system.read",
      "open-brain.capture",
      "slack.post.audit",
      "inventory.commit",
      "inventory.adjustment.large",
      "run.plan.commit",
    ],
    runtimePath: "src/app/api/ops/inventory/* + /ops/supply-chain",
    channel: "#operations",
  },
  {
    id: "sample-order-dispatch",
    name: "Sample/Order Dispatch (S-08)",
    contractPath: "contracts/agents/sample-order-dispatch.md",
    division: "production-supply-chain",
    humanOwner: "Ben",
    // Drew is a fulfillment NODE for samples + East Coast — never an
    // approver, never the human owner. Note carefully here so the
    // detector test doesn't trip.
    role: "Enforce orders→Ashford(Ben) / samples→East Coast(Drew). Class B shipment.create gate.",
    lifecycle: "live",
    approvalSlugs: [
      "system.read",
      "slack.post.audit",
      "shipment.create",
      "shipment.tracking-push",
    ],
    runtimePath: "src/app/api/ops/shipping/* + S-08 dispatcher",
    channel: "#shipping",
  },

  // --- System Build / Platform ---------------------------------------
  {
    id: "platform-specialist",
    name: "Platform Specialist (S-24)",
    contractPath: "contracts/agents/platform-specialist.md",
    division: "platform-data-automation",
    humanOwner: "Ben",
    role: "Connector health smoke-test + secret-rotation alerts",
    lifecycle: "partial",
    blocker: "Smoke-test runs ad-hoc; daily cron + #ops-alerts mirror not yet pinned",
    approvalSlugs: ["system.read", "connector.health.post", "slack.post.audit"],
    runtimePath: "src/app/api/ops/health + connector probes",
    channel: "#ops-audit",
  },
  {
    id: "research-librarian",
    name: "Research Librarian",
    contractPath: "contracts/agents/research-librarian.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Cross-cutting synthesis across R-1..R-7; weekly digest; entity dedup",
    lifecycle: "latent",
    blocker:
      "Awaiting R-1..R-7 runtime wiring (build-sequence.md gap #5 — external tool decisions)",
    approvalSlugs: [
      "system.read",
      "open-brain.capture",
      "research.post.tagged",
      "brief.publish",
    ],
    channel: "#research",
  },

  // --- Research / Growth ---------------------------------------------
  {
    id: "r1-consumer",
    name: "R-1 Consumer",
    contractPath: "contracts/agents/r1-consumer.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Consumer research lane",
    lifecycle: "latent",
    blocker: "External tool decision pending (Feedly / Muck Rack / SerpAPI)",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r2-market",
    name: "R-2 Market",
    contractPath: "contracts/agents/r2-market.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Market / category research lane",
    lifecycle: "latent",
    blocker: "External tool decision pending",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r3-competitive",
    name: "R-3 Competitive",
    contractPath: "contracts/agents/r3-competitive.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Competitor watch lane",
    lifecycle: "latent",
    blocker: "External tool decision pending",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r4-channel",
    name: "R-4 Channel",
    contractPath: "contracts/agents/r4-channel.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Channel / retailer research lane",
    lifecycle: "latent",
    blocker: "External tool decision pending",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r5-regulatory",
    name: "R-5 Regulatory",
    contractPath: "contracts/agents/r5-regulatory.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Regulatory watch lane (FDA / state Red-3 / labeling)",
    lifecycle: "latent",
    blocker: "External tool decision pending (USPTO TESS, SEC EDGAR, FDA feeds)",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r6-supply",
    name: "R-6 Supply",
    contractPath: "contracts/agents/r6-supply.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Ingredient + supply-chain research",
    lifecycle: "latent",
    blocker: "External tool decision pending",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
  {
    id: "r7-press",
    name: "R-7 Press",
    contractPath: "contracts/agents/r7-press.md",
    division: "research-intelligence",
    humanOwner: "Ben",
    role: "Press / media research lane",
    lifecycle: "latent",
    blocker: "External tool decision pending",
    approvalSlugs: ["system.read", "research.post.tagged", "open-brain.capture"],
    channel: "#research",
  },
]);

const OBSERVER_OUTPUTS = [
  "no_action",
  "failed_degraded",
  "escalated",
] as const satisfies readonly HeartbeatOutputState[];

const APPROVAL_OUTPUTS = [
  "no_action",
  "drafted",
  "approval_requested",
  "blocked_missing_data",
  "failed_degraded",
  "escalated",
] as const satisfies readonly HeartbeatOutputState[];

const TASK_OUTPUTS = [
  "no_action",
  "task_created",
  "failed_degraded",
  "escalated",
] as const satisfies readonly HeartbeatOutputState[];

const BRIEF_OUTPUTS = [
  "no_action",
  "drafted",
  "approval_requested",
  "failed_degraded",
  "escalated",
] as const satisfies readonly HeartbeatOutputState[];

const LATENT_OUTPUTS = [
  "blocked_missing_data",
  "failed_degraded",
  "escalated",
] as const satisfies readonly HeartbeatOutputState[];

const DEFAULT_BUDGET: AgentHeartbeatMetadata["budget"] = Object.freeze({
  monthlyUsdLimit: null,
  maxRunsPerDay: null,
});

function heartbeat(
  input: Omit<AgentHeartbeatMetadata, "budget"> & {
    budget?: AgentHeartbeatMetadata["budget"];
  },
): AgentHeartbeatMetadata {
  return { ...input, budget: input.budget ?? DEFAULT_BUDGET };
}

/**
 * Heartbeat read-model overlay. This does NOT activate any runtime;
 * it makes every shipped agent explicit about cadence, queue source,
 * output states, and budget guardrails before future heartbeats can
 * claim work.
 */
export const AGENT_HEARTBEATS: Readonly<Record<string, AgentHeartbeatMetadata>> =
  Object.freeze({
    viktor: heartbeat({
      cadence: "event",
      schedule: "Slack/manual sales requests; no autonomous send",
      queueSource: "Slack sales threads + HubSpot B2B context",
      outputStates: APPROVAL_OUTPUTS,
      nextPhase: "B2B Revenue Watcher heartbeat queue",
    }),
    "faire-specialist": heartbeat({
      cadence: "event",
      schedule: "Operator-reviewed Faire queue + Slack approvals",
      queueSource: "KV faire:invites + follow-up buckets",
      outputStates: APPROVAL_OUTPUTS,
    }),
    "b2b-revenue-watcher": heartbeat({
      cadence: "manual",
      schedule: "Manual dry-run via OpenAI workspace tool; cron not approved",
      queueSource:
        "Sales Command readers: stale buyers, Faire follow-ups, pending approvals, wholesale inquiries",
      outputStates: TASK_OUTPUTS,
      nextPhase: "Add fail-soft audit persistence, then seek cadence approval",
    }),
    "viktor-rene-capture": heartbeat({
      cadence: "event",
      schedule: "#finance decision replies",
      queueSource: "Slack #finance thread events",
      outputStates: TASK_OUTPUTS,
    }),
    "executive-brief": heartbeat({
      cadence: "cron",
      schedule: "Weekdays 08:00 PT + 17:00 PT",
      queueSource: "Control-plane daily brief inputs",
      outputStates: BRIEF_OUTPUTS,
      budget: { monthlyUsdLimit: 50, maxRunsPerDay: 2 },
    }),
    "drift-audit-runner": heartbeat({
      cadence: "cron",
      schedule: "Sunday weekly drift audit",
      queueSource: "Operating-memory sample + contracts",
      outputStates: OBSERVER_OUTPUTS,
      budget: { monthlyUsdLimit: 25, maxRunsPerDay: 1 },
    }),
    "compliance-specialist": heartbeat({
      cadence: "cron",
      schedule: "Daily compliance calendar check",
      queueSource: "In-repo compliance registry; Notion DB pending",
      outputStates: TASK_OUTPUTS,
      nextPhase: "Replace fallback registry with Notion compliance DB",
    }),
    interviewer: heartbeat({
      cadence: "manual",
      schedule: "Pre-build planning pass inside coding session",
      queueSource: "User-requested build prompts",
      outputStates: ["no_action", "drafted", "failed_degraded"],
    }),
    "transcript-saver": heartbeat({
      cadence: "event",
      schedule: "Correction / decision capture requests",
      queueSource: "Slack + session transcript snippets",
      outputStates: TASK_OUTPUTS,
    }),
    "slack-corrections-drift-detector": heartbeat({
      cadence: "manual",
      schedule: "On-demand operating-memory drift probe",
      queueSource: "Operating-memory entries",
      outputStates: OBSERVER_OUTPUTS,
    }),
    booke: heartbeat({
      cadence: "event",
      schedule: "Booke third-party categorization queue",
      queueSource: "Booke AI + QBO transaction feed",
      outputStates: APPROVAL_OUTPUTS,
      nextPhase: "Keep Rene approval boundary explicit",
    }),
    "finance-exception": heartbeat({
      cadence: "cron",
      schedule: "Daily finance exception digest",
      queueSource: "Receipts, approvals, reconciliation, QBO health",
      outputStates: BRIEF_OUTPUTS,
      budget: { monthlyUsdLimit: 35, maxRunsPerDay: 1 },
    }),
    "reconciliation-specialist": heartbeat({
      cadence: "cron",
      schedule: "Daily Plaid/QBO pre-work; weekly marketplace payouts",
      queueSource: "Plaid, QBO, Amazon, Shopify, Faire payout readers",
      outputStates: TASK_OUTPUTS,
    }),
    ops: heartbeat({
      cadence: "event",
      schedule: "Ops route events + manual operator requests",
      queueSource: "Vendor, PO, shipping, inventory queues",
      outputStates: APPROVAL_OUTPUTS,
    }),
    "inventory-specialist": heartbeat({
      cadence: "cron",
      schedule: "Daily ATP / cover-day forecast",
      queueSource: "Shopify inventory + supply-chain signals",
      outputStates: APPROVAL_OUTPUTS,
    }),
    "sample-order-dispatch": heartbeat({
      cadence: "event",
      schedule: "Order/sample shipment events",
      queueSource: "ShipStation + S-08 dispatcher queue",
      outputStates: APPROVAL_OUTPUTS,
    }),
    "platform-specialist": heartbeat({
      cadence: "cron",
      schedule: "Daily connector readiness smoke",
      queueSource: "Readiness env fingerprint + safe probes",
      outputStates: OBSERVER_OUTPUTS,
      budget: { monthlyUsdLimit: 15, maxRunsPerDay: 1 },
    }),
    "research-librarian": heartbeat({
      cadence: "latent",
      schedule: "Not activated — waits for R-1..R-7 sources",
      queueSource: "No queue yet",
      outputStates: LATENT_OUTPUTS,
      nextPhase: "Wire research source decisions first",
    }),
    "r1-consumer": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Consumer research feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r2-market": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Market/category feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r3-competitive": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Competitor watch feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r4-channel": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Channel/retailer feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r5-regulatory": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Regulatory source feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r6-supply": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Ingredient/supply source feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
    "r7-press": heartbeat({
      cadence: "latent",
      schedule: "Not activated — external tool decision pending",
      queueSource: "Press/media source feed TBD",
      outputStates: LATENT_OUTPUTS,
    }),
  });

/** Lookup helper. */
const AGENT_BY_ID = new Map(AGENT_REGISTRY.map((a) => [a.id, a] as const));

export function getAgentById(id: string): AgentEntry | undefined {
  return AGENT_BY_ID.get(id);
}

/**
 * The 6 dashboard packs. Each pack is a read-model — a curated cross-cut
 * over `AGENT_REGISTRY`. Adding a pack does NOT activate any agent.
 */
export const PACK_REGISTRY: readonly PackDef[] = Object.freeze([
  {
    id: "b2b-revenue",
    name: "B2B Revenue",
    audience: "Sales (Ben primary)",
    description:
      "Wholesale + Faire Direct + Slack-native sales intelligence. Per-send approval gate on every outbound; HubSpot is system of record.",
    primaryOwner: "Ben",
    memberIds: ["viktor", "faire-specialist", "b2b-revenue-watcher"],
  },
  {
    id: "executive-control",
    name: "Executive Control",
    audience: "Founder (Ben primary)",
    description:
      "Daily/EOD briefs, weekly drift audit, compliance calendar, pre-build spec discipline, operating-memory capture + drift.",
    primaryOwner: "Ben",
    memberIds: [
      "executive-brief",
      "drift-audit-runner",
      "compliance-specialist",
      "interviewer",
      "transcript-saver",
      "slack-corrections-drift-detector",
    ],
  },
  {
    id: "finance-cash",
    name: "Finance / Cash",
    audience: "Finance (Rene primary)",
    description:
      "Booke + finance exception digest + reconciliation pre-work + Rene's W-7 decision-queue capture.",
    primaryOwner: "Rene",
    memberIds: [
      "booke",
      "finance-exception",
      "reconciliation-specialist",
      "viktor-rene-capture",
    ],
  },
  {
    id: "ops-fulfillment",
    name: "Ops / Fulfillment",
    audience: "Operations (Ben primary)",
    description:
      "Vendor + PO + shipping; inventory ATP + cover-day forecast; canonical orders→Ashford / samples→East Coast routing.",
    primaryOwner: "Ben",
    memberIds: ["ops", "inventory-specialist", "sample-order-dispatch"],
  },
  {
    id: "system-build",
    name: "System Build",
    audience: "Platform (Ben primary)",
    description:
      "Connector health, secret rotation, research synthesis librarian. Substrate honesty.",
    primaryOwner: "Ben",
    memberIds: ["platform-specialist", "research-librarian"],
  },
  {
    id: "research-growth",
    name: "Research / Growth",
    audience: "Research (Ben primary)",
    description:
      "R-1..R-7 research lanes. All currently LATENT — awaiting external tool decisions per build-sequence.md gap #5.",
    primaryOwner: "Ben",
    memberIds: [
      "r1-consumer",
      "r2-market",
      "r3-competitive",
      "r4-channel",
      "r5-regulatory",
      "r6-supply",
      "r7-press",
    ],
  },
]);

const PACK_BY_ID = new Map<string, PackDef>(
  PACK_REGISTRY.map((p) => [p.id as string, p] as const),
);
export function getPackById(id: string): PackDef | undefined {
  return PACK_BY_ID.get(id);
}
