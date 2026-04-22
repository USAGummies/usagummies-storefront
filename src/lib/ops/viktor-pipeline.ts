/**
 * Viktor Pipeline Digest — pure composition.
 *
 * Extracted from the runtime so it can be unit-tested without mocking
 * HubSpot fetches. Takes the deal list + now-timestamp, returns a
 * full rollup + rendered Slack markdown.
 */

import { HUBSPOT, type PipelineDeal } from "./hubspot-client";

export const STAGE_LABEL: Record<string, string> = {
  [HUBSPOT.STAGE_LEAD]: "Lead",
  [HUBSPOT.STAGE_PO_RECEIVED]: "PO Received",
  [HUBSPOT.STAGE_SHIPPED]: "Shipped",
  [HUBSPOT.STAGE_CLOSED_WON]: "Closed Won",
};

export const PIPELINE_STALE_DAYS = 14;

export interface StageRollup {
  stage: string;
  label: string;
  count: number;
  totalDollars: number;
  staleCount: number;
}

export interface PipelineDigest {
  asOf: string;
  totalDeals: number;
  totalOpenDollars: number;
  rollup: StageRollup[];
  staleDeals: PipelineDeal[];
  closingSoon: PipelineDeal[];
  top5: PipelineDeal[];
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function isOpen(stage: string): boolean {
  return stage !== HUBSPOT.STAGE_SHIPPED && stage !== HUBSPOT.STAGE_CLOSED_WON;
}

/**
 * Aggregate deals into a rollup + flag stale + flag closing-soon.
 * Pure function — no I/O.
 */
export function summarizePipeline(
  deals: PipelineDeal[],
  now: Date = new Date(),
): PipelineDigest {
  const nowMs = now.getTime();
  const thirtyDaysFromNow = nowMs + 30 * 24 * 3600 * 1000;
  const rollupByStage = new Map<string, StageRollup>();
  const staleDeals: PipelineDeal[] = [];
  const closingSoon: PipelineDeal[] = [];

  for (const d of deals) {
    const label = STAGE_LABEL[d.dealstage] ?? (d.dealstage || "(unknown)");
    const entry =
      rollupByStage.get(d.dealstage) ??
      {
        stage: d.dealstage,
        label,
        count: 0,
        totalDollars: 0,
        staleCount: 0,
      };
    entry.count += 1;
    entry.totalDollars += d.amount ?? 0;

    if (isOpen(d.dealstage)) {
      if (d.daysSinceLastActivity > PIPELINE_STALE_DAYS) {
        entry.staleCount += 1;
        staleDeals.push(d);
      }
      if (d.closedate) {
        const closeTime = new Date(d.closedate).getTime();
        if (closeTime > 0 && closeTime <= thirtyDaysFromNow) {
          closingSoon.push(d);
        }
      }
    }
    rollupByStage.set(d.dealstage, entry);
  }

  const rollup = Array.from(rollupByStage.values()).sort(
    (a, b) => b.totalDollars - a.totalDollars,
  );
  const top5 = [...deals]
    .filter((d) => isOpen(d.dealstage))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 5);

  const totalOpenDollars = rollup
    .filter((r) => isOpen(r.stage))
    .reduce((s, r) => s + r.totalDollars, 0);

  return {
    asOf: now.toISOString(),
    totalDeals: deals.length,
    totalOpenDollars,
    rollup,
    staleDeals,
    closingSoon,
    top5,
  };
}

/**
 * Render a PipelineDigest as Slack-flavored markdown.
 * Pure function — no I/O.
 */
export function renderPipelineDigest(digest: PipelineDigest): string {
  const asOfDate = new Date(digest.asOf);
  const lines: string[] = [
    `:bust_in_silhouette: *Viktor pipeline digest — ${asOfDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}*`,
    `_${digest.totalDeals} deals on B2B Wholesale pipeline · ${money(digest.totalOpenDollars)} open_`,
    "",
    "*Stage breakdown:*",
  ];
  for (const r of digest.rollup) {
    const stalePart =
      r.staleCount > 0
        ? ` · :warning: ${r.staleCount} stale >${PIPELINE_STALE_DAYS}d`
        : "";
    lines.push(
      `  • *${r.label}* — ${r.count} deal(s) · ${money(r.totalDollars)}${stalePart}`,
    );
  }

  if (digest.closingSoon.length > 0) {
    lines.push("", "*Expected to close in 30 days:*");
    for (const d of digest.closingSoon.slice(0, 5)) {
      lines.push(
        `  • ${d.dealname || d.id} · ${money(d.amount ?? 0)} · close ${d.closedate?.slice(0, 10) ?? "?"}`,
      );
    }
    if (digest.closingSoon.length > 5) {
      lines.push(`  …and ${digest.closingSoon.length - 5} more`);
    }
  }

  if (digest.top5.length > 0) {
    lines.push("", "*Top 5 open deals by value:*");
    for (const d of digest.top5) {
      lines.push(
        `  • ${d.dealname || d.id} · ${money(d.amount ?? 0)} · ${STAGE_LABEL[d.dealstage] ?? d.dealstage} · ${d.daysSinceLastActivity}d since activity`,
      );
    }
  }

  if (digest.staleDeals.length > 0) {
    lines.push(
      "",
      `*Stale (no activity >${PIPELINE_STALE_DAYS}d):* ${digest.staleDeals.length} deal(s). Viktor should nudge.`,
    );
  }

  lines.push(
    "",
    "_Monday digest. Viktor maintains pipeline + answers questions in #sales. No autonomous writes outside HubSpot cleanup._",
  );

  return lines.join("\n");
}
