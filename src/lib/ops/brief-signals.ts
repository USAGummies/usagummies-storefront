/**
 * Operational signals aggregator — Phase 32.1.
 *
 * Five selector modules already produce one-line briefs:
 *
 *   - Stack readiness (`stack-readiness.ts` + summary)
 *   - Agent health (`agent-health.ts`)
 *   - USPTO trademarks (`uspto-trademarks.ts` `renderTrademarkBriefLine`)
 *   - Inbox triage (`inbox-triage-backlog.ts` `renderBacklogBriefLine`)
 *   - Inventory reorder (`inventory-reorder-trigger.ts` — exposed via
 *     forecast → render here, since the trigger module's own render
 *     was Slack-shaped not brief-shaped)
 *
 * Each is designed to **quiet-collapse** when there's nothing to
 * surface. The morning brief should aggregate them so a single
 * Slack-block is rendered with the union of operational signals
 * Ben actually needs to act on. If everything is green, the
 * section is omitted entirely (no "all systems nominal" noise).
 *
 * Order is deterministic, severity-first:
 *   1. Stack readiness reds (down services)
 *   2. Agent-health reds (drew-owns / unowned / job-without-approver / runtime-broken)
 *   3. Stack readiness degradeds (Make.com etc)
 *   4. USPTO actionable (critical/high/medium)
 *   5. Inbox triage awaiting decision
 *   6. Inventory reorder candidates
 *
 * Pure — no I/O. The brief route gathers the inputs and feeds
 * them in.
 */
import type { CoverDaysForecast } from "./inventory-forecast";
import type { AgentHealthRow } from "./agent-health";
import type { BacklogRow } from "./inbox-triage-backlog";
import type { StackServiceRow } from "./stack-readiness";
import type { TrademarkRow } from "./uspto-trademarks";

import {
  renderBacklogBriefLine,
  summarizeBacklog,
} from "./inbox-triage-backlog";
import {
  renderTrademarkBriefLine,
} from "./uspto-trademarks";
import {
  pickReorderCandidates,
} from "./inventory-reorder-trigger";

export interface BriefSignalsInput {
  /** Stack-readiness rows — typically from `/api/ops/stack-readiness`. */
  stackRows?: readonly StackServiceRow[];
  /** Agent-health rows — typically from `/api/ops/agents/health`. */
  agentRows?: readonly AgentHealthRow[];
  /** USPTO trademark rows — from `/api/ops/uspto/trademarks`. */
  trademarkRows?: readonly TrademarkRow[];
  /** Inbox triage backlog rows. */
  backlogRows?: readonly BacklogRow[];
  /** Inventory cover-days forecast (optional). */
  inventoryForecast?: CoverDaysForecast;
}

export interface BriefSignalsOutput {
  /** Ordered list of one-line brief contributions. Never includes empties. */
  lines: string[];
  /** Roll-up: `true` if any of the contributing selectors had a "down" or "red" signal. */
  hasCritical: boolean;
}

// Bumped 3 → 5 (2026-05-03): when 4 stack services are down (the
// observed common case during make.com/QBO/nextauth co-failures), the
// 3-cap was hiding the 4th name behind "(+1 more)" — operator can't
// triage what they can't see. 5 covers the realistic worst case
// without crowding the brief line.
const STACK_DOWN_LIMIT = 5;
const STACK_DEGRADED_LIMIT = 5;

/**
 * Render a single line summarizing stack-readiness `down` rows.
 * Quiet-collapse to "" when none are down. Pure.
 */
export function renderStackDownLine(
  rows: readonly StackServiceRow[],
): string {
  const down = rows.filter((r) => r.status === "down");
  if (down.length === 0) return "";
  const top = down.slice(0, STACK_DOWN_LIMIT).map((r) => r.id);
  const more = down.length > STACK_DOWN_LIMIT ? ` (+${down.length - STACK_DOWN_LIMIT} more)` : "";
  return `:rotating_light: *Stack — ${down.length} service${down.length === 1 ? "" : "s"} down:* ${top.join(", ")}${more}.`;
}

/**
 * Render a single line summarizing stack-readiness `degraded` rows.
 * Quiet-collapse to "" when none are degraded. Pure.
 */
export function renderStackDegradedLine(
  rows: readonly StackServiceRow[],
): string {
  const deg = rows.filter((r) => r.status === "degraded");
  if (deg.length === 0) return "";
  const top = deg.slice(0, STACK_DEGRADED_LIMIT).map((r) => r.id);
  const more = deg.length > STACK_DEGRADED_LIMIT ? ` (+${deg.length - STACK_DEGRADED_LIMIT} more)` : "";
  return `:warning: *Stack — ${deg.length} service${deg.length === 1 ? "" : "s"} degraded:* ${top.join(", ")}${more}.`;
}

/**
 * Render a single line summarizing agent-health red rows.
 * Quiet-collapse to "" when none are red. Pure.
 */
export function renderAgentHealthRedLine(
  rows: readonly AgentHealthRow[],
): string {
  const reds = rows.filter((r) => r.health === "red");
  if (reds.length === 0) return "";
  const top = reds.slice(0, 3).map((r) => r.id);
  const more = reds.length > 3 ? ` (+${reds.length - 3} more)` : "";
  return `:no_entry: *Agents — ${reds.length} doctrinal red flag${reds.length === 1 ? "" : "s"}:* ${top.join(", ")}${more}.`;
}

/**
 * Render a single line summarizing reorder candidates.
 * Quiet-collapse when forecast is missing OR no urgent/soon SKUs. Pure.
 */
export function renderReorderLine(
  forecast?: CoverDaysForecast,
): string {
  if (!forecast) return "";
  const candidates = pickReorderCandidates(forecast, { limit: 5 });
  if (candidates.length === 0) return "";
  const urgentCount = candidates.filter((c) => c.urgency === "urgent").length;
  const tag = urgentCount > 0 ? `${urgentCount} urgent` : "soon";
  const top = candidates.slice(0, 3).map((c) => c.sku);
  return `:package: *Reorder — ${candidates.length} SKU${candidates.length === 1 ? "" : "s"} below threshold (${tag}):* ${top.join(", ")}.`;
}

/**
 * Aggregate all selector outputs into a deterministic list of brief
 * lines. Empty lines are filtered out so the brief route can render
 * the section conditionally.
 */
export function composeBriefSignals(
  input: BriefSignalsInput,
): BriefSignalsOutput {
  const stackRows = input.stackRows ?? [];
  const agentRows = input.agentRows ?? [];
  const trademarkRows = input.trademarkRows ?? [];
  const backlogRows = input.backlogRows ?? [];

  const stackDownLine = renderStackDownLine(stackRows);
  const stackDegradedLine = renderStackDegradedLine(stackRows);
  const agentRedLine = renderAgentHealthRedLine(agentRows);
  const tmLine = renderTrademarkBriefLine(trademarkRows);
  const backlogSummary = summarizeBacklog(backlogRows);
  const backlogLine = renderBacklogBriefLine(backlogSummary);
  const reorderLine = renderReorderLine(input.inventoryForecast);

  // Deterministic order: severity-first.
  const ordered = [
    stackDownLine,
    agentRedLine,
    stackDegradedLine,
    tmLine,
    backlogLine,
    reorderLine,
  ];
  const lines = ordered.filter((l) => l && l.length > 0);
  const hasCritical =
    stackDownLine.length > 0 ||
    agentRedLine.length > 0 ||
    // Critical-tier USPTO + critical-tier inbox both produce
    // distinct icons; we count them as critical-equivalent.
    /critical/i.test(tmLine) ||
    backlogSummary.stale > 0;

  return { lines, hasCritical };
}
