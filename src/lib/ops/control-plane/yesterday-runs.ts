/**
 * Yesterday's-run aggregator — reads audit entries to summarize the
 * outcome of the auto-fire-nudges + ad-kill-switch crons.
 *
 * Closes audit finding "run-result aggregate in morning brief" — the
 * crons fire at 7 AM and 7:30 AM, but their outcomes were invisible
 * unless an operator dug through #ops-audit. This pulls the prior-
 * day's run summaries and surfaces a one-line synopsis at the top of
 * the morning brief so Ben sees:
 *
 *   ⚡ Auto-fire-nudges yesterday: fired 4 · skipped 2 (recently nudged) · failed 0
 *   📉 Ad-kill-switch yesterday: KILL — Google Ads $1,678 with 0 conv
 *
 * Pure function. Caller (brief route) supplies the audit entries
 * window; this module classifies and renders.
 */
import type { AuditLogEntry } from "./types";

export interface YesterdayRunsSummary {
  /** ISO date the lines describe (YYYY-MM-DD). */
  forDate: string;
  /** One-line synopses, ordered by importance (kill-switch first when present). */
  lines: string[];
}

interface AutoFireRunPayload {
  fired?: number;
  skipped?: number;
  failed?: number;
  perDetector?: Record<
    string,
    { eligible?: number; fired?: number }
  >;
  degraded?: string[];
}

interface AdKillRunPayload {
  severity?: "kill" | "warn" | "ok";
  shouldKill?: boolean;
  totalSpendUsd?: number;
  totalConversions?: number;
  perPlatform?: Array<{
    platform?: string;
    severity?: "kill" | "warn" | "ok";
    spendUsd?: number | null;
    conversions?: number | null;
  }>;
}

function parseDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function findMostRecentByAgent(
  entries: readonly AuditLogEntry[],
  agentId: string,
  forDate: string,
): AuditLogEntry | null {
  // Both crons write a single roll-up audit entry per fire. We look
  // for the one whose createdAt falls on `forDate` — typically the
  // run that fired in the early morning of forDate, summarizing the
  // PRIOR day's data.
  const matches = entries.filter(
    (e) =>
      e.actorId === agentId && parseDateOnly(e.createdAt) === forDate,
  );
  if (matches.length === 0) return null;
  // Most recent first.
  return [...matches].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  )[0];
}

function renderAutoFireLine(entry: AuditLogEntry): string {
  const after = (entry.after ?? {}) as AutoFireRunPayload;
  const fired = after.fired ?? 0;
  const skipped = after.skipped ?? 0;
  const failed = after.failed ?? 0;
  const degraded = after.degraded ?? [];
  const headline = failed > 0 ? ":warning:" : ":zap:";

  const detailParts: string[] = [];
  if (fired > 0) detailParts.push(`fired *${fired}*`);
  detailParts.push(`skipped ${skipped}`);
  if (failed > 0) detailParts.push(`*failed ${failed}*`);
  const detail = detailParts.join(" · ");

  let perDetectorDetail = "";
  if (after.perDetector) {
    const breakdown = Object.entries(after.perDetector)
      .filter(([, v]) => (v?.fired ?? 0) > 0)
      .map(([k, v]) => `${k} ${v?.fired ?? 0}`);
    if (breakdown.length > 0) {
      perDetectorDetail = `  _(${breakdown.join(" · ")})_`;
    }
  }

  const degradedSuffix =
    degraded.length > 0 ? `  :warning: ${degraded.length} degraded` : "";

  return `${headline} *Auto-fire nudges yesterday:* ${detail}${perDetectorDetail}${degradedSuffix}`;
}

function renderAdKillLine(entry: AuditLogEntry): string {
  const after = (entry.after ?? {}) as AdKillRunPayload;
  const severity = after.severity ?? "ok";
  const totalSpend = after.totalSpendUsd ?? 0;
  const totalConv = after.totalConversions ?? 0;

  if (severity === "ok") {
    // Quiet-collapse — healthy days don't need a brief line.
    return "";
  }

  const headerEmoji = severity === "kill" ? ":rotating_light:" : ":warning:";
  const verdict = severity === "kill" ? "*KILL*" : "warn";
  const platformBlame = (after.perPlatform ?? [])
    .filter((p) => p.severity !== "ok")
    .map(
      (p) =>
        `${p.platform === "meta" ? "Meta" : p.platform === "google" ? "Google" : p.platform} $${(p.spendUsd ?? 0).toFixed(2)} → ${p.conversions ?? 0} conv`,
    )
    .join(", ");

  return `${headerEmoji} *Ad-kill-switch yesterday:* ${verdict} — ${platformBlame || `total $${totalSpend.toFixed(2)} → ${totalConv} conv`}`;
}

/**
 * Build the YesterdayRunsSummary from audit entries scoped to the
 * day we care about. The brief route passes today's `recentAudit`
 * window — the function itself filters to forDate.
 *
 * Returns an empty summary (lines = []) when neither cron logged on
 * forDate — the brief composer omits the section entirely on quiet
 * days.
 */
export function summarizeYesterdayRuns(
  entries: readonly AuditLogEntry[],
  forDate: string,
): YesterdayRunsSummary {
  const lines: string[] = [];

  const adKill = findMostRecentByAgent(entries, "ad-kill-switch", forDate);
  if (adKill) {
    const ln = renderAdKillLine(adKill);
    if (ln) lines.push(ln);
  }

  const autoFire = findMostRecentByAgent(entries, "auto-fire-nudges", forDate);
  if (autoFire) {
    lines.push(renderAutoFireLine(autoFire));
  }

  return { forDate, lines };
}
