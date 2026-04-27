/**
 * Daily brief composer.
 *
 * Blueprint §15.4 W3a: "Turn on recurring daily brief cadence — 7 AM PT
 * morning brief + 6 PM PT EOD wrap — in #ops-daily via a Make.com
 * scenario referencing src/app/api/ops/daily-brief."
 *
 * Scope — day-one: the composer reports **control-plane state** that we
 * already have authoritative access to (open approvals, paused agents,
 * recent audit activity, active-division roster, most-recent weekly
 * drift-audit scorecard summary).
 *
 * External revenue sources (Shopify, Amazon SP-API, Faire, Plaid,
 * HubSpot) are NOT wired here yet — the brief either shows a real
 * number from a live query when the integration is provided by the
 * caller, or it says "unavailable" with the reason. Per blueprint
 * non-negotiable #2: never fabricate figures.
 *
 * The composer is pure (input → text). The route fetches and the
 * composer renders. Tests exercise render-only paths deterministically.
 */

import type { ApprovalRequest, AuditLogEntry } from "./types";
import type { PausedAgentRecord } from "./enforcement";
import type { SalesCommandSlice } from "@/lib/ops/sales-command-center";

export type BriefKind = "morning" | "eod";

export interface RevenueLine {
  /** "Shopify DTC", "Amazon", "Faire", etc. */
  channel: string;
  /** Dollar amount in USD, or null if unavailable. Never NaN. */
  amountUsd: number | null;
  /** If amountUsd is null, why. Short human-readable. */
  unavailableReason?: string;
  /** Live source id/url so humans can verify — required when amountUsd is non-null. */
  source?: { system: string; id?: string; retrievedAt: string };
}

/**
 * AR bucket — one side of the sent-only AR + drafts-separately split.
 *
 * Per the 2026-03-30 Ben correction (Finance / Register — Decision Log):
 * "AR counts only SENT invoices; drafts are NOT AR. Drafts report
 * separately: 'Drafts: $X in N unsent invoices (not yet AR)'."
 *
 * Every non-null amountUsd requires source.system + source.retrievedAt
 * (no-fabrication rule). Every null amountUsd requires an unavailableReason.
 */
export interface ARBucket {
  /** Sum of dollar amounts in USD, or null if unavailable. Never NaN. */
  amountUsd: number | null;
  /** Count of invoices in this bucket. Zero is a valid value; null means unavailable. */
  count: number | null;
  /** If amountUsd/count are null, why. Short human-readable. */
  unavailableReason?: string;
  /** Live source id/url — required when amountUsd is non-null. */
  source?: { system: string; retrievedAt: string };
}

export interface ARPosition {
  /** Sent invoices with open balance — the only bucket that counts as AR. */
  outstanding: ARBucket;
  /** Unsent invoice drafts — NOT AR per 2026-03-30 Ben correction. */
  drafts: ARBucket;
}

export interface BriefInput {
  kind: BriefKind;
  /** Timestamp the brief is "as of". */
  asOf: Date;
  /**
   * Active divisions (from the registry). Used to show division health
   * + open-approval routing in the brief.
   */
  activeDivisions: Array<{ id: string; name: string; humanOwner: string }>;
  /** Open pending approvals, typically from approvalStore().listPending(). */
  pendingApprovals: ApprovalRequest[];
  /** Currently paused agents from the PauseSink. */
  pausedAgents: PausedAgentRecord[];
  /**
   * Recent audit entries from auditStore().recent(N) — used to compute
   * activity volume per division in the last 24h.
   */
  recentAudit: AuditLogEntry[];
  /**
   * Most recent weekly drift-audit scorecard summary line if any. The
   * caller constructs this by searching recent audit for entries with
   * action="drift-audit.scorecard" and picking the newest.
   */
  lastDriftAuditSummary?: string;
  /**
   * Yesterday's revenue by channel. Caller supplies; composer does NOT
   * fabricate. Every channel either has a real amountUsd + source or
   * an unavailableReason.
   */
  revenueYesterday?: RevenueLine[];
  /**
   * Cash position from Plaid (BoA checking 7020 primary). Same rule —
   * live number + source or explicit unavailableReason.
   */
  cashPosition?: {
    amountUsd: number | null;
    unavailableReason?: string;
    source?: { system: string; retrievedAt: string };
  };
  /**
   * AR position — split per 2026-03-30 Ben correction. Outstanding AR
   * counts ONLY sent invoices; drafts are reported separately and are
   * explicitly NOT AR. If unavailable (QBO unreachable or Make.com
   * scenario didn't provide), the composer renders "unavailable" with
   * the reason — never fabricates.
   */
  arPosition?: ARPosition;
  /**
   * Shipping Hub pre-flight snapshot. When provided, the morning brief
   * renders wallet / ATP / freight-comp-queue / stale-voids so Ben
   * knows before the 10:00 PT Ops Agent digest whether he can ship.
   * Caller (daily-brief route) fetches from `computeFulfillmentPreflight()`.
   */
  preflight?: FulfillmentPreflightSlice;
  /**
   * EOD-only: fulfillment activity since midnight PT. Populated by
   * the daily-brief route when `kind === "eod"`. Renders a
   * "today in review" section closing Ben's shipping day.
   */
  fulfillmentToday?: FulfillmentTodayBriefSlice;
  /**
   * Morning-only: compact sales-command summary covering Faire
   * invites/follow-ups, pending Slack approvals, AP packets, retail
   * drafts, wholesale inquiries. The route populates this from the
   * shared sales-command readers + `composeSalesCommandSlice`. The
   * composer renders it ONLY when `kind === "morning"` and the slice
   * is present. Skipped on EOD to avoid duplicating the cumulative
   * #ops-daily picture.
   */
  salesCommand?: SalesCommandSlice;
  /**
   * Morning-only: dispatch throughput in the previous 24h. Populated
   * by the daily-brief route from `buildDispatchBoardRows` +
   * `composeDispatchBriefSlice`. Composer renders ONE line:
   *   `Dispatch: X bought · Y dispatched · Z still open (last 24h).`
   * Quiet collapse when zero activity. Skipped on EOD because the
   * fulfillmentToday slice already covers labels-bought there.
   */
  dispatch?: DispatchBriefSlice;
  /** Any degradations to call out at the top of the brief. */
  degradations?: string[];
}

/**
 * Last-24h dispatch throughput. Counts come from the dispatch board
 * projection (`DispatchBoardRow[]`), filtered to the previous 24h
 * window by ship date / dispatched-at.
 */
export interface DispatchBriefSlice {
  /** ISO timestamp the slice was computed at. */
  generatedAt: string;
  /** Window end (exclusive); typically `generatedAt`. */
  windowEnd: string;
  /** Window start (inclusive); typically `windowEnd - 24h`. */
  windowStart: string;
  /** Labels purchased in the last 24h (regardless of dispatch state). */
  labelsBought: number;
  /** Of those, marked dispatched within the window. */
  dispatched: number;
  /** Of those, still sitting on the cart (state = open). */
  stillOpen: number;
  /** ISO date (YYYY-MM-DD) of the OLDEST open package's ship date.
   *  null when no open packages or no parseable ship dates. */
  oldestOpenShipDate: string | null;
  /** Age in whole days of the oldest open package vs. windowEnd.
   *  null when oldestOpenShipDate is null. Used to gate the callout. */
  oldestOpenAgeDays: number | null;
}

/** Threshold (in days) above which the morning brief callouts the
 *  oldest open package. Below this, the dispatch line stays compact.
 *  3 days matches Ben's hard rule on Amazon FBM ≤ 2 business days
 *  to ship-by — anything older than 3 calendar days is genuinely
 *  stale and worth a nudge. */
export const DISPATCH_BRIEF_STALE_DAYS = 3;

/** Minimal shape — matches fields used in the brief. */
export interface FulfillmentPreflightSlice {
  walletAlerts: Array<{
    carrierCode: string;
    balance: number | null;
    floor: number;
  }>;
  atp: {
    totalBagsOnHand: number | null;
    pendingOutboundBags: number;
    availableBags: number | null;
    snapshotAgeHours: number | null;
    unavailableReason?: string;
  };
  freightCompQueue: { queuedCount: number; queuedDollars: number };
  staleVoids: { count: number; pendingDollars: number };
  amazonFbm?: {
    unshippedCount: number;
    urgentCount: number;
    lateCount: number;
    unavailableReason?: string;
  };
  alerts: string[];
}

export interface FulfillmentTodayBriefSlice {
  sinceIso: string;
  labelsBought: {
    count: number;
    spendDollars: number;
    byCarrier: Record<string, { count: number; dollars: number }>;
  };
  labelsVoided: { count: number; pendingRefundDollars: number };
  freightCompQueue: {
    queuedToday: { count: number; dollars: number };
    postedToday: { count: number; dollars: number };
    rejectedToday: { count: number; dollars: number };
  };
}

export interface BriefOutput {
  text: string; // Slack-flavored markdown, fallback / mobile-friendly
  blocks: unknown[]; // Slack Block Kit for richer rendering
  meta: {
    kind: BriefKind;
    asOf: string;
    pendingApprovalCount: number;
    pausedAgentCount: number;
    activityLast24h: number;
    degraded: boolean;
  };
}

// ----- Composer ---------------------------------------------------------

export function composeDailyBrief(input: BriefInput): BriefOutput {
  const asOfIso = input.asOf.toISOString();
  const kindLabel = input.kind === "morning" ? "Morning brief" : "End-of-day wrap";
  const pendingCount = input.pendingApprovals.length;
  const pausedCount = input.pausedAgents.length;
  const degraded = (input.degradations ?? []).length > 0;

  const activityByDivision = countByDivision(input.recentAudit, input.asOf);

  const fallbackText = `${kindLabel} — ${asOfIso} — ${pendingCount} pending approval(s), ${pausedCount} paused agent(s)${degraded ? " — DEGRADED" : ""}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🇺🇸 ${kindLabel}`, emoji: true },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*As of:* \`${asOfIso}\`  •  *kind:* \`${input.kind}\`` },
      ],
    },
  ];

  // Degraded banner goes first so readers can't miss it.
  if (degraded) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Degraded brief* — the following data sources were unavailable or unpopulated:\n${(input.degradations ?? []).map((d) => `• ${d}`).join("\n")}`,
      },
    });
  }

  // ---- Priorities: pending approvals + paused agents ----
  const priorities: string[] = [];
  priorities.push(
    pendingCount > 0
      ? `*${pendingCount}* pending approval(s) in \`#ops-approvals\` — see breakdown below.`
      : `*0* pending approvals.`,
  );
  if (pausedCount > 0) {
    const agentList = input.pausedAgents.map((p) => `\`${p.agentId}\``).join(", ");
    priorities.push(`🛑 *${pausedCount}* paused agent(s) require review: ${agentList}.`);
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Priorities*\n${priorities.join("\n")}` },
  });

  // ---- Revenue yesterday ----
  if (input.revenueYesterday && input.revenueYesterday.length > 0) {
    const rows = input.revenueYesterday
      .map((r) => {
        // Defensive coercion: if amountUsd is non-null but source is
        // missing system OR retrievedAt, refuse to render the number.
        // The route validates the same rule at the boundary (400), but
        // direct composer callers (tests, future code) get the same
        // protection here. Blueprint non-negotiable #2: every output
        // carries source + timestamp + confidence.
        const hasValidSource =
          !!r.source && !!r.source.system && !!r.source.retrievedAt;
        if (r.amountUsd != null && hasValidSource) {
          const srcParts = [r.source!.system, r.source!.id, r.source!.retrievedAt].filter(
            (x): x is string => !!x,
          );
          const src = ` _(${srcParts.join(", ")})_`;
          return `• *${r.channel}:* $${r.amountUsd.toFixed(2)}${src}`;
        }
        if (r.amountUsd != null && !hasValidSource) {
          return `• *${r.channel}:* unavailable — amount=${r.amountUsd} suppressed: missing source.system or source.retrievedAt (no-fabrication rule)`;
        }
        return `• *${r.channel}:* unavailable — ${r.unavailableReason ?? "no reason given"}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Revenue (yesterday)*\n${rows}` },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Revenue (yesterday)*\n_External revenue integrations not wired into the brief yet (Shopify / Amazon / Faire). Per blueprint non-negotiable #2, this is shown as unavailable rather than fabricated._`,
      },
    });
  }

  // ---- Cash position ----
  if (input.cashPosition) {
    const cp = input.cashPosition;
    const hasValidSource = !!cp.source && !!cp.source.system && !!cp.source.retrievedAt;
    if (cp.amountUsd != null && hasValidSource) {
      const src = ` _(${cp.source!.system}, ${cp.source!.retrievedAt})_`;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Cash (BoA checking 7020)*  $${cp.amountUsd.toFixed(2)}${src}`,
        },
      });
    } else if (cp.amountUsd != null && !hasValidSource) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Cash (BoA checking 7020)*  unavailable — amount=${cp.amountUsd} suppressed: missing source.system or source.retrievedAt (no-fabrication rule)`,
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Cash (BoA checking 7020)*  unavailable — ${cp.unavailableReason ?? "no reason given"}`,
        },
      });
    }
  }

  // ---- AR position (sent-only) + Drafts (not yet AR) ----
  //
  // 2026-03-30 Ben correction (Finance Decision Log): AR counts only
  // SENT invoices. Drafts report separately and are explicitly NOT AR.
  // Each bucket follows the same no-fabrication rule as revenue/cash —
  // live number + source or explicit unavailableReason.
  if (input.arPosition) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: renderARPositionMarkdown(input.arPosition),
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*AR Outstanding (sent invoices)*  unavailable — QBO AR query not wired into this run; drafts are NOT AR per 2026-03-30 Ben correction.`,
      },
    });
  }

  // ---- Shipping Hub pre-flight (morning only) ----
  if (input.kind === "morning" && input.preflight) {
    const pfLines = renderPreflightMarkdown(input.preflight);
    if (pfLines) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: pfLines },
      });
    }
  }

  // ---- Sales Command compact section (morning only) ----
  // Phase 2 of the Sales Command Center — surfaces the day's revenue
  // actions in one block on Ben's morning brief instead of a
  // separate noisy digest. Skipped on EOD because the cumulative
  // dashboard view at /ops/sales is what closes the loop.
  if (input.kind === "morning" && input.salesCommand) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: renderSalesCommandMarkdown(input.salesCommand),
      },
    });
  }

  // ---- Dispatch throughput (morning only) ----
  // Last 24h: labels bought / dispatched / still open. One line.
  // Skipped on EOD because the fulfillmentToday slice already covers
  // labels-bought for that surface.
  if (input.kind === "morning" && input.dispatch) {
    const line = renderDispatchBriefMarkdown(input.dispatch);
    if (line) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: line } });
    }
  }

  // ---- Fulfillment today in review (EOD only) ----
  if (input.kind === "eod" && input.fulfillmentToday) {
    const ft = renderFulfillmentTodayMarkdown(input.fulfillmentToday);
    if (ft) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: ft } });
    }
  }

  // ---- Pending approvals breakdown ----
  if (pendingCount > 0) {
    const grouped = groupApprovalsByDivision(input.pendingApprovals);
    const lines = Object.entries(grouped)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([division, reqs]) => {
        const preview = reqs
          .slice(0, 3)
          .map((r) => `    - \`${r.action}\` (class ${r.class}, approvers: ${r.requiredApprovers.join(",")})`)
          .join("\n");
        return `• *${division}* (${reqs.length}):\n${preview}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Pending approvals by division*\n${lines}` },
    });
  }

  // ---- Activity (audit entries last 24h) ----
  const totalActivity = Object.values(activityByDivision).reduce((a, b) => a + b, 0);
  if (totalActivity > 0) {
    const rows = Object.entries(activityByDivision)
      .sort((a, b) => b[1] - a[1])
      .map(([division, count]) => `• *${division}:* ${count}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Audit activity (last 24h)*\n${rows}` },
    });
  }

  // ---- Active divisions roster (always shown for orientation) ----
  const divisionRoster = input.activeDivisions
    .map((d) => `• *${d.name}* — ${d.humanOwner}`)
    .join("\n");
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Active divisions*\n${divisionRoster}` },
  });

  // ---- Last drift audit summary ----
  if (input.lastDriftAuditSummary) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*Last drift audit:* ${input.lastDriftAuditSummary}` },
      ],
    });
  }

  return {
    text: fallbackText,
    blocks,
    meta: {
      kind: input.kind,
      asOf: asOfIso,
      pendingApprovalCount: pendingCount,
      pausedAgentCount: pausedCount,
      activityLast24h: totalActivity,
      degraded,
    },
  };
}

// ----- Helpers ----------------------------------------------------------

function countByDivision(entries: AuditLogEntry[], asOf: Date): Record<string, number> {
  const cutoff = asOf.getTime() - 24 * 3_600_000;
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (new Date(e.createdAt).getTime() < cutoff) continue;
    out[e.division] = (out[e.division] ?? 0) + 1;
  }
  return out;
}

function groupApprovalsByDivision(reqs: ApprovalRequest[]): Record<string, ApprovalRequest[]> {
  const out: Record<string, ApprovalRequest[]> = {};
  for (const r of reqs) {
    if (!out[r.division]) out[r.division] = [];
    out[r.division].push(r);
  }
  return out;
}

/**
 * Render the two-line AR block: Outstanding (sent invoices only) and
 * Drafts (not yet AR). Enforces the same no-fabrication rule as revenue
 * and cash — a non-null amountUsd requires source.system + source.retrievedAt,
 * else the line prints "unavailable — <reason>".
 *
 * 2026-03-30 Ben correction: "AR counts only SENT invoices; drafts are
 * NOT AR. Drafts report separately."
 */
function renderARPositionMarkdown(ar: ARPosition): string {
  return [
    `*AR Outstanding (sent invoices)*  ${renderARBucket(ar.outstanding)}`,
    `*Drafts (not yet AR)*  ${renderARBucket(ar.drafts)}`,
  ].join("\n");
}

function renderARBucket(bucket: ARBucket): string {
  const hasValidSource =
    !!bucket.source && !!bucket.source.system && !!bucket.source.retrievedAt;
  if (bucket.amountUsd != null && bucket.count != null && hasValidSource) {
    const src = ` _(${bucket.source!.system}, ${bucket.source!.retrievedAt})_`;
    return `$${bucket.amountUsd.toFixed(2)} across ${bucket.count} invoice(s)${src}`;
  }
  if ((bucket.amountUsd != null || bucket.count != null) && !hasValidSource) {
    return `unavailable — amount=${bucket.amountUsd} count=${bucket.count} suppressed: missing source.system or source.retrievedAt (no-fabrication rule)`;
  }
  return `unavailable — ${bucket.unavailableReason ?? "no reason given"}`;
}

function renderPreflightMarkdown(pf: FulfillmentPreflightSlice): string {
  const lines: string[] = ["*Shipping Hub pre-flight*"];

  // Wallet
  if (pf.walletAlerts.length > 0) {
    for (const w of pf.walletAlerts) {
      const bal = w.balance === null ? "—" : `$${w.balance.toFixed(2)}`;
      lines.push(
        `🚨 \`${w.carrierCode}\` wallet ${bal} below floor $${w.floor.toFixed(0)} — top up before next buy`,
      );
    }
  }

  // ATP
  const atp = pf.atp;
  if (atp.unavailableReason) {
    lines.push(`❓ ATP: _${atp.unavailableReason}_`);
  } else if (atp.totalBagsOnHand !== null && atp.availableBags !== null) {
    if (atp.availableBags < 36) {
      lines.push(
        `⚠️ ATP low: ${atp.availableBags} bags available (${atp.totalBagsOnHand} on-hand − ${atp.pendingOutboundBags} pending)`,
      );
    }
    if (atp.snapshotAgeHours !== null && atp.snapshotAgeHours > 36) {
      lines.push(
        `📦 Inventory snapshot ${atp.snapshotAgeHours}h stale — POST /api/ops/inventory/snapshot to refresh`,
      );
    }
  }

  // Freight-comp queue
  if (pf.freightCompQueue.queuedCount > 0) {
    lines.push(
      `📥 Freight-comp JE queue: ${pf.freightCompQueue.queuedCount} pending · $${pf.freightCompQueue.queuedDollars.toFixed(2)} (Rene approves)`,
    );
  }

  // Stale voids
  if (pf.staleVoids.count > 0) {
    lines.push(
      `💸 Stale ShipStation voids: ${pf.staleVoids.count} · $${pf.staleVoids.pendingDollars.toFixed(2)} pending refund`,
    );
  }

  // Amazon FBM queue
  if (pf.amazonFbm && !pf.amazonFbm.unavailableReason) {
    if (pf.amazonFbm.lateCount > 0) {
      lines.push(
        `🚨 Amazon FBM: ${pf.amazonFbm.lateCount} LATE order(s) past ship-by`,
      );
    } else if (pf.amazonFbm.urgentCount > 0) {
      lines.push(
        `⏰ Amazon FBM: ${pf.amazonFbm.urgentCount} urgent order(s) (<12h to ship-by) · ${pf.amazonFbm.unshippedCount} total unshipped`,
      );
    } else if (pf.amazonFbm.unshippedCount > 0) {
      lines.push(
        `📦 Amazon FBM: ${pf.amazonFbm.unshippedCount} unshipped order(s) in queue (/ops/amazon-fbm)`,
      );
    }
  }

  // Only render the section when there's actually something to say.
  return lines.length > 1
    ? lines.join("\n")
    : "*Shipping Hub pre-flight*\n✅ All clear — wallets above floor, ATP healthy, queue empty, no stale voids.";
}

function renderFulfillmentTodayMarkdown(ft: FulfillmentTodayBriefSlice): string {
  const lines: string[] = ["*Fulfillment — today in review*"];

  const bought = ft.labelsBought;
  if (bought.count === 0) {
    lines.push("• No labels bought today.");
  } else {
    const carrierBreakdown = Object.entries(bought.byCarrier)
      .map(([c, b]) => `${c} ${b.count}`)
      .join(" · ");
    lines.push(
      `• 📦 *${bought.count}* label(s) bought · *$${bought.spendDollars.toFixed(2)}*` +
        (carrierBreakdown ? `  _(${carrierBreakdown})_` : ""),
    );
  }

  if (ft.labelsVoided.count > 0) {
    lines.push(
      `• 💸 *${ft.labelsVoided.count}* label(s) voided · refund pending *$${ft.labelsVoided.pendingRefundDollars.toFixed(2)}*`,
    );
  }

  const q = ft.freightCompQueue;
  const qBits: string[] = [];
  if (q.queuedToday.count > 0) {
    qBits.push(
      `${q.queuedToday.count} queued ($${q.queuedToday.dollars.toFixed(2)})`,
    );
  }
  if (q.postedToday.count > 0) {
    qBits.push(
      `${q.postedToday.count} posted ($${q.postedToday.dollars.toFixed(2)})`,
    );
  }
  if (q.rejectedToday.count > 0) {
    qBits.push(
      `${q.rejectedToday.count} rejected ($${q.rejectedToday.dollars.toFixed(2)})`,
    );
  }
  if (qBits.length > 0) {
    lines.push(`• 📋 CF-09 queue: ${qBits.join(" · ")}`);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Render the compact Sales Command section for the morning brief.
 *
 * Locked rules (every one tested):
 *   - Section is bounded — under ~10 lines including header and
 *     deep-link footer. (We assert ≤ 12 lines as the upper bound to
 *     accommodate a full actionable state plus the empty footer.)
 *   - When every wired count is zero (and `anyAction` is false), the
 *     rendering collapses to a single empty-state line:
 *     "*Sales Command*\n_No sales actions queued._" — so the morning
 *     brief stays quiet on quiet days.
 *   - `null` numerics render as "not wired", NEVER as 0. (Zero is a
 *     real "wired but quiet" count and earns its own line; null is
 *     a missing source.)
 *   - Wholesale inquiries always renders honestly. While the source
 *     is `not_wired`, the line reads "Wholesale inquiries: not wired"
 *     instead of being silently dropped — so we don't pretend the
 *     pipe doesn't exist.
 *   - Deep links are static (`/ops/sales`, `/ops/faire-direct`,
 *     `/ops/ap-packets`, `/ops/locations`) and live in the footer
 *     line so the body counts stay scannable.
 */
export function renderSalesCommandMarkdown(slice: SalesCommandSlice): string {
  const header = "*Sales Command — today's actions*";
  const footer =
    "_Open: <https://www.usagummies.com/ops/sales|/ops/sales> · " +
    "<https://www.usagummies.com/ops/faire-direct|Faire Direct> · " +
    "<https://www.usagummies.com/ops/ap-packets|AP packets> · " +
    "<https://www.usagummies.com/ops/locations|Store locator>_";

  if (!slice.anyAction) {
    // Even on a quiet day, surface the Weekly Revenue KPI one-liner
    // when the slice carries it. The KPI is contextual (not an
    // action); rendering it preserves the daily revenue pulse
    // without making the section noisy.
    const quietLines = [header, "_No sales actions queued._"];
    if (slice.revenueKpi) {
      quietLines.push(`• ${slice.revenueKpi.text}`);
    }
    quietLines.push(footer);
    return quietLines.join("\n");
  }

  const lines: string[] = [header];

  // Faire invites awaiting review.
  lines.push(
    `• Faire invites awaiting review: ${formatCount(
      slice.faireInvitesNeedsReview,
    )}`,
  );

  // Faire follow-ups (combined line — overdue first to match dashboard sort).
  if (
    slice.faireFollowUpsOverdue === null &&
    slice.faireFollowUpsDueSoon === null
  ) {
    lines.push("• Faire follow-ups: not wired");
  } else {
    const overdue = formatCount(slice.faireFollowUpsOverdue);
    const dueSoon = formatCount(slice.faireFollowUpsDueSoon);
    lines.push(`• Faire follow-ups: ${overdue} overdue · ${dueSoon} due soon`);
  }

  // Pending Slack approvals.
  lines.push(
    `• Slack approvals awaiting Ben: ${formatCount(slice.pendingApprovals)}`,
  );

  // AP packets — only render when any of the AP counts has signal.
  if (
    slice.apPacketsActionRequired === null &&
    slice.apPacketsSent === null
  ) {
    lines.push("• AP packets: not wired");
  } else {
    const action = formatCount(slice.apPacketsActionRequired);
    const sent = formatCount(slice.apPacketsSent);
    lines.push(`• AP packets: ${action} action-required · ${sent} sent`);
  }

  // Retail drafts.
  if (
    slice.retailDraftsNeedsReview === null &&
    slice.retailDraftsAccepted === null
  ) {
    lines.push("• Retail drafts: not wired");
  } else {
    const need = formatCount(slice.retailDraftsNeedsReview);
    const accepted = formatCount(slice.retailDraftsAccepted);
    lines.push(`• Retail drafts: ${need} to review · ${accepted} accepted`);
  }

  // Wholesale inquiries — surfaced honestly even when not_wired.
  lines.push(
    `• Wholesale inquiries: ${formatCount(slice.wholesaleInquiries)}`,
  );

  // Phase 4 — Weekly Revenue KPI one-liner. NEVER fabricates a
  // number — the renderer in revenue-kpi.ts falls back to
  // "Revenue pace not fully wired." when no channel is wired.
  if (slice.revenueKpi) {
    lines.push(`• ${slice.revenueKpi.text}`);
  }

  // Phase 3 — up to 3 aging callouts (critical → overdue → watch).
  // The slice's agingCallouts list is pre-sorted + capped by
  // `composeAgingBriefCallouts`. Empty array → no aging block, so
  // the section stays tight on quiet days.
  const callouts = slice.agingCallouts ?? [];
  if (callouts.length > 0) {
    lines.push("*Aging:*");
    for (const c of callouts) {
      lines.push(`• ${c.text}`);
    }
  }

  lines.push(footer);
  return lines.join("\n");
}

/** Format a wired count or render "not wired" for null. NEVER returns
 *  "0" for null; that would erase the difference between an empty
 *  queue and a missing source. */
function formatCount(value: number | null): string {
  return value === null ? "_not wired_" : `*${value}*`;
}

/**
 * Project dispatch board rows into a 24-hour `DispatchBriefSlice`.
 *
 * Window: `[now - 24h, now)`. A row counts as "bought in window" iff
 * its `shipDate` is on/within the window; "dispatched in window" iff
 * its `dispatchedAt` is within the window. We deliberately don't
 * combine the two predicates — a row purchased pre-window but
 * dispatched in-window IS counted as "dispatched" but NOT as
 * "bought," so the throughput numbers reflect what actually happened
 * during the window without double-counting backfills.
 *
 * `stillOpen` is the subset of bought-in-window rows whose state is
 * "open" — i.e. labels bought yesterday that haven't physically left
 * yet. That's the "what to nudge" signal for the morning brief.
 *
 * Pure: same input → same output. Defensive on null timestamps.
 */
export function composeDispatchBriefSlice(
  rows: ReadonlyArray<{
    shipDate: string | null;
    dispatchedAt: string | null;
    state: "open" | "dispatched";
  }>,
  now?: Date,
): DispatchBriefSlice {
  const end = (now ?? new Date()).getTime();
  const start = end - 24 * 3600 * 1000;
  const windowEndIso = new Date(end).toISOString();
  const windowStartIso = new Date(start).toISOString();

  const inWindow = (iso: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    return t >= start && t < end;
  };

  let labelsBought = 0;
  let dispatched = 0;
  let stillOpen = 0;
  // Oldest open ship date — lex-smallest ISO YYYY-MM-DD across ALL
  // open rows (not just bought-in-window — a package bought 5 days
  // ago and still open is the exact thing this signal is for).
  let oldestOpenShipDate: string | null = null;
  for (const r of rows) {
    const boughtInWindow = inWindow(r.shipDate);
    const dispatchedInWindow = inWindow(r.dispatchedAt);
    if (boughtInWindow) labelsBought += 1;
    if (dispatchedInWindow) dispatched += 1;
    if (boughtInWindow && r.state === "open") stillOpen += 1;
    if (
      r.state === "open" &&
      typeof r.shipDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.shipDate) &&
      (!oldestOpenShipDate || r.shipDate < oldestOpenShipDate)
    ) {
      oldestOpenShipDate = r.shipDate;
    }
  }

  let oldestOpenAgeDays: number | null = null;
  if (oldestOpenShipDate) {
    const shipMs = Date.parse(oldestOpenShipDate + "T00:00:00Z");
    if (Number.isFinite(shipMs)) {
      // Whole days, floor — a package shipped 2.7 days ago is "2 days
      // on the cart" today, not "3."
      oldestOpenAgeDays = Math.max(
        0,
        Math.floor((end - shipMs) / (24 * 3600 * 1000)),
      );
    }
  }

  return {
    generatedAt: windowEndIso,
    windowEnd: windowEndIso,
    windowStart: windowStartIso,
    labelsBought,
    dispatched,
    stillOpen,
    oldestOpenShipDate,
    oldestOpenAgeDays,
  };
}

/**
 * Render the dispatch slice as one or two Slack-flavored markdown lines.
 *
 * Line 1 — `:package: Dispatch (last 24h)` summary. Quiet collapse:
 * returns empty string when there's no activity in the window AND no
 * stale open package callout (so the brief doesn't pad with `0/0/0`
 * noise).
 *
 * Line 2 (conditional) — when `oldestOpenAgeDays > DISPATCH_BRIEF_STALE_DAYS`,
 * appends a `:warning: Oldest open package: N days on the cart`
 * nudge. This is what unblocks "go drop them off" when a package
 * has been silently aging in the queue past Ben's hard rule
 * (Amazon FBM ≤ 2 business days).
 */
export function renderDispatchBriefMarkdown(slice: DispatchBriefSlice): string {
  const hasActivity =
    slice.labelsBought > 0 || slice.dispatched > 0 || slice.stillOpen > 0;
  const stale =
    slice.oldestOpenAgeDays !== null &&
    slice.oldestOpenAgeDays > DISPATCH_BRIEF_STALE_DAYS;
  if (!hasActivity && !stale) return "";

  const lines: string[] = [];
  if (hasActivity) {
    const parts: string[] = [
      `*${slice.labelsBought}* bought`,
      `*${slice.dispatched}* dispatched`,
    ];
    if (slice.stillOpen > 0) {
      parts.push(
        `*${slice.stillOpen}* still on cart` +
          (slice.stillOpen === 1 ? " — go drop it off" : " — go drop them off"),
      );
    }
    lines.push(`:package: *Dispatch (last 24h)*  ${parts.join(" · ")}`);
  }
  if (stale && slice.oldestOpenAgeDays !== null) {
    const dayWord = slice.oldestOpenAgeDays === 1 ? "day" : "days";
    lines.push(
      `:warning: *Oldest open package: ${slice.oldestOpenAgeDays} ${dayWord} on the cart* — past the 2-business-day handling promise; print + drop today.`,
    );
  }
  return lines.join("\n");
}
