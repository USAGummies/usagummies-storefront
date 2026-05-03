/**
 * CRM Hygiene digest renderer — pure function. Turns a `HygieneFindings`
 * shape into Slack mrkdwn for the daily Wholesale Pipeline Commander
 * post to #sales.
 *
 * Design rules:
 *   - Quiet-collapse: zero findings → returns null. Don't post a
 *     "nothing to do!" line every morning that operators learn to ignore.
 *   - Severity headers (critical first, then warn, then info).
 *   - Top-N (default 12) listed with deal name + reason + suggested
 *     follow-up. Each row deep-links to the HubSpot deal so Ben can
 *     click into it without searching.
 *   - Footer line summarizes total + by-kind counts so the operator
 *     understands the scale without reading every row.
 *
 * No I/O. No Slack post. Caller decides where to post the rendered text.
 */
import type { Finding, FindingKind, HygieneFindings } from "./detectors";
import { HUBSPOT_B2B_STAGES } from "../../ops/hubspot-client";

const HUBSPOT_PORTAL_ID = "44037769";

const STAGE_NAME_BY_ID = new Map<string, string>(
  HUBSPOT_B2B_STAGES.map((s) => [s.id, s.name]),
);

function dealLink(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`;
}

function stageLabel(stageId: string): string {
  return STAGE_NAME_BY_ID.get(stageId) ?? stageId;
}

function kindEmoji(kind: FindingKind): string {
  switch (kind) {
    case "missing-field":
      return ":pencil2:";
    case "stale-deal":
      return ":hourglass_flowing_sand:";
    case "zero-dollar":
      return ":heavy_dollar_sign:";
    case "stuck-in-stage":
      return ":warning:";
    case "duplicate-name":
      return ":busts_in_silhouette:";
    case "closed-with-open-amount":
      return ":scissors:";
    default:
      return ":small_blue_diamond:";
  }
}

function kindLabel(kind: FindingKind): string {
  switch (kind) {
    case "missing-field":
      return "Missing field";
    case "stale-deal":
      return "Stale";
    case "zero-dollar":
      return "Zero $";
    case "stuck-in-stage":
      return "Stuck";
    case "duplicate-name":
      return "Duplicate";
    case "closed-with-open-amount":
      return "Closed w/ amount";
    default:
      return kind;
  }
}

function severityEmoji(severity: Finding["severity"]): string {
  switch (severity) {
    case "critical":
      return ":rotating_light:";
    case "warn":
      return ":warning:";
    case "info":
      return ":information_source:";
  }
}

function renderFindingLine(f: Finding): string {
  const stage = stageLabel(f.stageId);
  const link = `<${dealLink(f.dealId)}|${f.dealname}>`;
  const severityIcon = severityEmoji(f.severity);
  const kindIcon = kindEmoji(f.kind);
  return [
    `${severityIcon} ${kindIcon} *${link}* — \`${stage}\``,
    `   _${f.reason}_`,
    `   → ${f.suggestedFollowUp}`,
  ].join("\n");
}

export interface DigestRenderOptions {
  /** Date label for the header — typically asOf.toISOString().slice(0,10). */
  forDate: string;
  /** Total deals scanned upstream — surfaces the denominator. */
  totalDealsScanned: number;
  /** Top-N findings to actually list (rows). Default 12. */
  topN?: number;
}

/**
 * Render the digest. Returns null when there's nothing to say (quiet-
 * collapse). Caller skips posting when null.
 */
export function composeHygieneDigest(
  findings: HygieneFindings,
  opts: DigestRenderOptions,
): string | null {
  if (findings.total === 0) return null;
  const topN = Math.max(1, Math.min(50, opts.topN ?? 12));
  const top = findings.topFindings.slice(0, topN);

  const headline = [
    `:bar_chart: *CRM Hygiene — ${opts.forDate}*`,
    `*${findings.total} finding${findings.total === 1 ? "" : "s"}* across *${findings.affectedDealIds.length}* deal${findings.affectedDealIds.length === 1 ? "" : "s"} _(scanned ${opts.totalDealsScanned})_`,
  ].join("\n");

  const sevSummary = [
    findings.bySeverity.critical > 0
      ? `:rotating_light: ${findings.bySeverity.critical} critical`
      : null,
    findings.bySeverity.warn > 0
      ? `:warning: ${findings.bySeverity.warn} warn`
      : null,
    findings.bySeverity.info > 0
      ? `:information_source: ${findings.bySeverity.info} info`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");

  const kindCounts = (
    [
      "stuck-in-stage",
      "stale-deal",
      "zero-dollar",
      "missing-field",
      "duplicate-name",
      "closed-with-open-amount",
    ] as FindingKind[]
  )
    .map((k) => {
      const n = findings.byKind[k].length;
      if (n === 0) return null;
      return `${kindLabel(k)} ${n}`;
    })
    .filter((x): x is string => x !== null)
    .join(" · ");

  const body =
    top.length > 0
      ? top.map(renderFindingLine).join("\n\n")
      : "_(no top-N findings — see counters above)_";

  const truncationNote =
    findings.total > top.length
      ? `\n\n_Showing top ${top.length} of ${findings.total}. Run \`GET /api/ops/agents/crm-hygiene/run\` for the full list._`
      : "";

  return [
    headline,
    sevSummary,
    kindCounts,
    "",
    body,
    truncationNote,
  ]
    .filter((s) => s !== "" || true) // keep empty separator lines
    .join("\n");
}
