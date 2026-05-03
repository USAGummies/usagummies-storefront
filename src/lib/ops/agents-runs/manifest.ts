/**
 * Agent manifest — the canonical hand-curated list of agents that
 * the `/ops/agents/status` strip and `/ops/agents/runs/[agentId]`
 * timeline view both render against.
 *
 * Intentionally NOT auto-derived from `/contracts/agents/*.md`. The
 * manifest is small enough that hand-curating wins over a contract
 * parser — and decoupling the UI from contract-file shape means a
 * contract reorg can't blank out the status board.
 *
 * Add a new agent here once it has a real audit footprint (i.e. it
 * actually writes audit envelopes via `record()` or
 * `auditStore().append()`).
 */

export interface AgentManifestEntry {
  /** `actorId` value the agent writes in audit log entries. */
  id: string;
  /** Human display name. */
  name: string;
  /** Path to the contract file (informational link). */
  contract: string;
  /** Internal route the agent fires from. */
  runtimePath: string;
  /** Cadence string — used by status staleness assessor. */
  cadence: string;
  /** Where the agent posts (informational). */
  channel: string;
  /** Optional one-line caveat (degraded mode, blocked dependency, etc). */
  notes?: string;
}

export const AGENT_MANIFEST: readonly AgentManifestEntry[] = Object.freeze([
  {
    id: "executive-brief",
    name: "Executive Brief",
    contract: "/contracts/agents/executive-brief.md",
    runtimePath: "/api/ops/daily-brief",
    cadence: "Weekday 08:00 PT (morning) + Tue-Sat 17:00 PT (EOD)",
    channel: "#ops-daily",
  },
  {
    id: "finance-exception",
    name: "Finance Exception Agent",
    contract: "/contracts/agents/finance-exception.md",
    runtimePath: "/api/ops/agents/finance-exception/run",
    cadence: "Weekday 06:15 PT",
    channel: "#finance",
  },
  {
    id: "ops",
    name: "Ops Agent",
    contract: "/contracts/agents/ops.md",
    runtimePath: "/api/ops/agents/ops/run",
    cadence: "Weekday 10:00 PT",
    channel: "#operations",
  },
  {
    id: "compliance-specialist",
    name: "Compliance Specialist",
    contract: "/contracts/agents/compliance-specialist.md",
    runtimePath: "/api/ops/agents/compliance/run",
    cadence: "Weekday 11:00 PT",
    channel: "#operations",
    notes: "Degraded until /Legal/Compliance Calendar Notion DB lands",
  },
  {
    id: "faire-specialist",
    name: "Faire Specialist",
    contract: "/contracts/agents/faire-specialist.md",
    runtimePath: "/api/ops/agents/faire/run",
    cadence: "Thursday 11:00 PT",
    channel: "#finance + #sales",
    notes: "Degraded until FAIRE_ACCESS_TOKEN is set",
  },
  {
    id: "b2b-revenue-watcher",
    name: "B2B Revenue Watcher",
    contract: "/contracts/agents/b2b-revenue-watcher.md",
    runtimePath: "/api/ops/agents/b2b-revenue-watcher/run",
    cadence: "Weekday 14:45 UTC audit-only heartbeat",
    channel: "/ops/sales + OpenAI workspace tool",
    notes:
      "Read-only heartbeat: no Slack post, Gmail send, HubSpot mutation, or approval opening",
  },
  {
    id: "email-agents-readiness",
    name: "Email Agents Readiness",
    contract: "/contracts/email-agents-system.md",
    runtimePath: "/api/ops/agents/email-intel/run",
    cadence: "Manual readiness heartbeat; no cron while incident gate remains open",
    channel: "/ops/email-agents + OpenAI workspace tool",
    notes:
      "Read-only heartbeat: no Gmail scan, draft creation, Slack approval, HubSpot mutation, or direct email-intel runner",
  },
  {
    id: "reconciliation-specialist",
    name: "Reconciliation Specialist",
    contract: "/contracts/agents/reconciliation-specialist.md",
    runtimePath: "/api/ops/agents/reconciliation/run",
    cadence: "Thursday 10:00 PT",
    channel: "#finance",
  },
  {
    id: "amazon-settlement",
    name: "Amazon Settlement Recon",
    contract: "—",
    runtimePath: "/api/ops/agents/amazon-settlement/run",
    cadence: "Thursday 10:30 PT",
    channel: "#finance",
  },
  {
    id: "research-librarian",
    name: "Research Librarian",
    contract: "/contracts/agents/research-librarian.md",
    runtimePath: "/api/ops/agents/research/run",
    cadence: "Friday 11:00 PT",
    channel: "#research",
  },
  {
    id: "drift-audit-runner",
    name: "Drift Audit Runner",
    contract: "/contracts/agents/drift-audit-runner.md",
    runtimePath: "/api/ops/control-plane/drift-audit",
    cadence: "Monday 20:00 PT",
    channel: "#ops-audit",
  },
  {
    id: "fulfillment-drift-audit",
    name: "Fulfillment Drift Audit",
    contract: "/contracts/integrations/shipstation.md §11-§12",
    runtimePath: "/api/ops/control-plane/fulfillment-drift-audit",
    cadence: "Monday 20:30 PT",
    channel: "#ops-audit",
  },
  {
    id: "shipstation-health",
    name: "ShipStation Health (wallet + voids)",
    contract: "/contracts/integrations/shipstation.md",
    runtimePath: "/api/ops/shipstation/wallet-check",
    cadence: "Weekday 09:00 PT",
    channel: "#operations",
  },
  {
    id: "sample-order-dispatch",
    name: "Sample/Order Dispatch (S-08)",
    contract: "/contracts/agents/sample-order-dispatch.md",
    runtimePath: "/api/ops/agents/sample-dispatch/dispatch",
    cadence:
      "Event-driven (Shopify orders/paid + HubSpot deal-stage change)",
    channel: "#ops-approvals + #ops-alerts",
  },
  {
    id: "auto-fire-nudges",
    name: "Auto-fire Nudges",
    contract: "—",
    runtimePath: "/api/ops/sales/auto-fire-nudges/run",
    cadence: "Daily",
    channel: "#ops-approvals (per-buyer cards)",
    notes:
      "Orchestrator that turns sample-touch-2 / reorder-offer / onboarding-nudge propose endpoints into autonomous fires",
  },
  {
    id: "ad-kill-switch",
    name: "Ad-Spend Kill Switch",
    contract: "—",
    runtimePath: "/api/ops/ads/kill-switch/run",
    cadence: "Daily",
    channel: "#ops-approvals (kill) / #ops-alerts (warn)",
    notes:
      "Detects spend-without-conversions on Meta + Google Ads. Detector only — never pauses ads via API.",
  },
]);

/**
 * Lookup an agent by id. Returns null when the id isn't in the
 * manifest — caller decides whether that's a 404 or a generic
 * "show audit entries anyway with stub metadata" path.
 */
export function getAgentManifestEntry(
  id: string,
): AgentManifestEntry | null {
  return AGENT_MANIFEST.find((m) => m.id === id) ?? null;
}

/** All known agent ids. Useful for static-param generation in pages. */
export function listAgentIds(): readonly string[] {
  return AGENT_MANIFEST.map((m) => m.id);
}
