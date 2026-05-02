import type { SourceState } from "./sales-command-center";
import type { SalesPipelineSummary } from "./sales-pipeline";
import type { StaleBuyerSummary } from "@/lib/sales/stale-buyer";
import {
  buildClosingMachineReport,
  renderClosingMachineBriefLine,
  type ClosingMachineReport,
} from "./may-closing-machine";

export type HubSpotProactiveKind =
  | "stale_buyer"
  | "stale_sample"
  | "open_call_task";

export type HubSpotProactiveSeverity = "critical" | "watch" | "info";

export interface HubSpotProactiveItem {
  id: string;
  kind: HubSpotProactiveKind;
  severity: HubSpotProactiveSeverity;
  label: string;
  detail: string;
  nextAction: string;
  source: "hubspot";
  href: string;
  ageDays: number | null;
}

export interface HubSpotProactiveReport {
  generatedAt: string;
  status: "ready" | "error" | "not_wired";
  counts: {
    total: number;
    critical: number;
    watch: number;
    info: number;
    staleBuyers: number;
    staleSamples: number;
    openCallTasks: number;
  };
  topItems: HubSpotProactiveItem[];
  closingMachine: ClosingMachineReport;
  notes: Array<{ source: string; state: "error" | "not_wired"; reason: string }>;
  source: {
    system: "hubspot";
    pipeline: "B2B Wholesale";
  };
}

const TOP_LIMIT = 8;

function daysSince(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

function severityForAge(days: number | null): HubSpotProactiveSeverity {
  if (days === null) return "watch";
  if (days >= 21) return "critical";
  if (days >= 7) return "watch";
  return "info";
}

function severityRank(severity: HubSpotProactiveSeverity): number {
  if (severity === "critical") return 0;
  if (severity === "watch") return 1;
  return 2;
}

function hubSpotDealHref(id: string): string {
  return `https://app.hubspot.com/contacts/deal/${encodeURIComponent(id)}`;
}

function hubSpotTaskHref(id: string): string {
  return `https://app.hubspot.com/tasks/${encodeURIComponent(id)}`;
}

function collectNotes(
  sources: Array<[string, SourceState<unknown> | undefined]>,
): HubSpotProactiveReport["notes"] {
  const notes: HubSpotProactiveReport["notes"] = [];
  for (const [source, state] of sources) {
    if (!state) {
      notes.push({
        source,
        state: "not_wired",
        reason: `${source} source not provided`,
      });
      continue;
    }
    if (state.status === "error" || state.status === "not_wired") {
      notes.push({ source, state: state.status, reason: state.reason });
    }
  }
  return notes;
}

export function buildHubSpotProactiveReport(input: {
  salesPipeline?: SourceState<SalesPipelineSummary>;
  staleBuyers?: SourceState<StaleBuyerSummary>;
  now?: Date;
  topLimit?: number;
}): HubSpotProactiveReport {
  const now = input.now ?? new Date();
  const topLimit = Math.max(0, input.topLimit ?? TOP_LIMIT);
  const notes = collectNotes([
    ["salesPipeline", input.salesPipeline],
    ["staleBuyers", input.staleBuyers],
  ]);
  const items: HubSpotProactiveItem[] = [];

  if (input.staleBuyers?.status === "wired") {
    for (const row of input.staleBuyers.value.stalest) {
      const ageDays = Number.isFinite(row.daysSinceActivity)
        ? row.daysSinceActivity
        : null;
      items.push({
        id: `stale-buyer:${row.dealId}`,
        kind: "stale_buyer",
        severity: severityForAge(ageDays),
        label: row.dealName,
        detail: `${row.stageName} · ${ageDays === null ? "no activity timestamp" : `${ageDays}d idle`}`,
        nextAction: row.nextAction,
        source: "hubspot",
        href: hubSpotDealHref(row.dealId),
        ageDays,
      });
    }
  }

  if (input.salesPipeline?.status === "wired") {
    for (const row of input.salesPipeline.value.staleSampleShipped.preview) {
      const ageDays = daysSince(now, row.lastModifiedAt);
      items.push({
        id: `stale-sample:${row.id}`,
        kind: "stale_sample",
        severity: severityForAge(ageDays),
        label: row.dealname ?? row.id,
        detail: ageDays === null ? "Sample shipped · no modified timestamp" : `Sample shipped · ${ageDays}d since update`,
        nextAction: "Ask for taste reaction and next wholesale step",
        source: "hubspot",
        href: hubSpotDealHref(row.id),
        ageDays,
      });
    }

    for (const task of input.salesPipeline.value.openCallTasks.preview) {
      const ageDays = daysSince(now, task.dueAt);
      items.push({
        id: `call-task:${task.id}`,
        kind: "open_call_task",
        severity: task.priority === "HIGH" ? "watch" : "info",
        label: task.subject ?? "Open HubSpot call task",
        detail: [
          task.priority ? `Priority ${task.priority}` : null,
          task.dueAt ? `due ${task.dueAt.slice(0, 10)}` : "no due date",
        ].filter(Boolean).join(" · "),
        nextAction: "Call or dismiss the HubSpot task after review",
        source: "hubspot",
        href: hubSpotTaskHref(task.id),
        ageDays,
      });
    }
  }

  const sorted = [...items].sort((a, b) => {
    const sev = severityRank(a.severity) - severityRank(b.severity);
    if (sev !== 0) return sev;
    return (b.ageDays ?? -1) - (a.ageDays ?? -1);
  });

  const counts = {
    total: items.length,
    critical: items.filter((i) => i.severity === "critical").length,
    watch: items.filter((i) => i.severity === "watch").length,
    info: items.filter((i) => i.severity === "info").length,
    staleBuyers: items.filter((i) => i.kind === "stale_buyer").length,
    staleSamples: items.filter((i) => i.kind === "stale_sample").length,
    openCallTasks: items.filter((i) => i.kind === "open_call_task").length,
  };

  return {
    generatedAt: now.toISOString(),
    status: notes.some((n) => n.state === "error")
      ? "error"
      : notes.some((n) => n.state === "not_wired")
        ? "not_wired"
        : "ready",
    counts,
    topItems: sorted.slice(0, topLimit),
    closingMachine: buildClosingMachineReport(sorted),
    notes,
    source: {
      system: "hubspot",
      pipeline: "B2B Wholesale",
    },
  };
}

export function renderHubSpotProactiveBriefLine(
  report: HubSpotProactiveReport,
): string {
  if (report.status === "error") return "HubSpot proactive queue: degraded";
  if (report.status === "not_wired") return "HubSpot proactive queue: not wired";
  if (report.counts.total === 0) return "HubSpot proactive queue: quiet";
  return `${renderClosingMachineBriefLine(report.closingMachine)} · ${report.counts.critical} critical`;
}
