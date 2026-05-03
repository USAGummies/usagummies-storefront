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
import type { VendorMarginAlert } from "@/lib/finance/per-vendor-margin";
import type {
  OffGridQuote,
  OffGridQuotesBriefSlice,
  OffGridSeverity,
} from "@/lib/finance/off-grid-quotes";
import type { SalesCommandSlice } from "@/lib/ops/sales-command-center";
import type { EnrichmentOpportunitiesSummary } from "@/lib/sales/enrichment-opportunities";
import type { OnboardingBlockersSummary } from "@/lib/sales/onboarding-blockers";
import type { ReorderFollowUpSummary } from "@/lib/sales/reorder-followup";
import type { SampleQueueHealth } from "@/lib/sales/sample-queue";
import type { StaleBuyerSummary } from "@/lib/sales/stale-buyer";

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

/**
 * EOD-only P&L slice. Rendered after the fulfillment-today block in
 * the end-of-day debrief. Closes the loop on Day 1's morning revenue
 * wiring: morning shows yesterday's revenue + cash position; EOD
 * adds COGS + fixed costs + net + MTD totals + runway.
 *
 * No-fabrication contract:
 *   • `yesterday` and `mtd` lines REQUIRE a source.system + retrievedAt
 *     when amounts are non-null.
 *   • `cogs` + `fixedCosts` are honestly labeled as `[estimated]`
 *     (forward COGS at $1.557/unit; daily fixed share of $900/mo
 *     monthly recurring) since QBO actuals aren't wired here.
 *   • `runwayMonths` is rendered ONLY when both cash AND
 *     monthlyBurnUsd are non-null. Composer omits the runway line if
 *     either input is missing — never fabricates.
 *
 * Caller (daily-brief route) populates this from `computeDailyPnL()`
 * + the resolved cash position in the EOD branch only.
 */
export interface DailyPnlBriefSlice {
  /** Yesterday's date (YYYY-MM-DD) — what the numbers are anchored to. */
  date: string;
  /** Yesterday's revenue + costs + net (USD). */
  yesterday: {
    revenueUsd: number | null;
    cogsUsdEstimated: number | null;
    fixedCostsUsdEstimated: number | null;
    netUsd: number | null;
    unavailableReason?: string;
  };
  /** Month-to-date totals (USD). */
  mtd: {
    revenueUsd: number | null;
    cogsUsdEstimated: number | null;
    fixedCostsUsdEstimated: number | null;
    netUsd: number | null;
    unavailableReason?: string;
  };
  /** 30-day burn estimate (USD/mo). Null when no input data. */
  monthlyBurnUsdEstimated: number | null;
  /** Cash / monthly burn — months of runway. Null when either input is null. */
  runwayMonthsEstimated: number | null;
  /** Source citation — kpi_timeseries window + retrievedAt. */
  source?: { system: string; retrievedAt: string };
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
   * EOD-only: yesterday net + MTD net + monthly burn + runway. Pulled
   * from `computeDailyPnL()` (Supabase kpi_timeseries window) + the
   * resolved cash position. Composer renders ONLY when `kind === "eod"`
   * and the slice is present. No-fabrication contract enforced — see
   * `DailyPnlBriefSlice` docstring for details.
   */
  dailyPnl?: DailyPnlBriefSlice;
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
   * Morning-only: top vendor-margin alerts from the canonical
   * per-vendor margin ledger. Read-only contract parse; no QBO,
   * HubSpot, or pricing writes. Quiet-collapse when no alerts.
   */
  vendorMargin?: VendorMarginBriefSlice;
  /**
   * Morning-only: Phase 36.6 off-grid pricing visibility flag. Surfaces
   * every quote / deal / invoice priced at anything OTHER than the
   * canonical B1-B5 grid (or the locked distributor commitments) so
   * Ben + Rene see them BEFORE they ship. Hard-block flag fires when
   * any quote is below the $2.12 minimum-margin floor — Class C
   * `pricing.change` ratification required to ship.
   *
   * Read-only: pure detection logic on candidates the caller fetched
   * from HubSpot / booth-quote / sales-tour KV.
   *
   * Pairs with `/contracts/wholesale-pricing.md` v2.4 + `/contracts/financial-mechanisms-blueprint.md` §6.7.
   * Quiet-collapse when no off-grid quotes in the window.
   */
  offGridQuotes?: OffGridQuotesBriefSlice;
  /**
   * Morning-only: Phase D1 stale-buyer detection. Populated by the
   * daily-brief route from `summarizeStaleBuyers(deals, now,
   * retrievedAt)` over `listRecentDeals()`. Composer renders the
   * top-N stalest deals + per-stage counts ONLY when `kind ===
   * "morning"` and at least one stale deal exists. Quiet-collapse
   * when the staleness queue is empty.
   *
   * Doctrine: `/contracts/session-handoff.md` "B2B Revenue operating
   * loop (Phase D)" — D1 + D6 ship together as the morning-brief
   * surface for stale-buyer follow-up.
   */
  staleBuyers?: StaleBuyerSummary;
  /**
   * Morning-only: Phase D2 sample-queue health snapshot. Surfaces the
   * complementary view to `staleBuyers` — the "awaiting ship" sample
   * requests Drew/Ben need to pack and the active "shipped, waiting
   * for response" funnel size + aging tail. Quiet-collapses when both
   * counts are zero.
   */
  sampleQueue?: SampleQueueHealth;
  /**
   * Morning-only: Phase D4 reorder follow-up. Channel-aware reorder
   * candidates: Amazon FBM 60d, wholesale (B2B Shipped) 90d, Shopify
   * DTC 90d (D4 v0.2 — placeholder slot). Quiet-collapses when no
   * candidates across any channel.
   */
  reorderFollowUps?: ReorderFollowUpSummary;
  /**
   * Morning-only: Phase D3 wholesale-onboarding blockers. Surfaces
   * stalled flows (currentStep has a nextStep, lastTimestamp is older
   * than `stallHours`) from the wholesale-onboarding KV store. The
   * existing Rene-review surface (`/api/ops/wholesale/onboarding`) +
   * dedicated digest (`/api/ops/wholesale/onboarding-digest`) remain
   * the source of truth for the financials channel; this brief slot
   * is the morning glance for Ben.
   */
  onboardingBlockers?: OnboardingBlockersSummary;
  /**
   * Morning-only: Phase D5 v0.3 Apollo enrichment opportunities. A
   * lightweight count of recent HubSpot contacts missing enrichable
   * fields (firstname, lastname, jobtitle, phone, company, city,
   * state). NO Apollo lookups happen in this surface — the actual
   * enrichment sweep is a separate operator action via
   * `POST /api/ops/sales/apollo-enrich/sweep`. Quiet-collapses
   * when zero opportunities.
   */
  enrichmentOpportunities?: EnrichmentOpportunitiesSummary;
  /**
   * Morning-only: dispatch throughput in the previous 24h. Populated
   * by the daily-brief route from `buildDispatchBoardRows` +
   * `composeDispatchBriefSlice`. Composer renders ONE line:
   *   `Dispatch: X bought · Y dispatched · Z still open (last 24h).`
   * Quiet collapse when zero activity. Skipped on EOD because the
   * fulfillmentToday slice already covers labels-bought there.
   */
  dispatch?: DispatchBriefSlice;
  /**
   * Phase 32.1 — operational signals aggregated from
   * stack-readiness + agent-health + USPTO + inbox-triage +
   * inventory-reorder. Composer renders a single section listing
   * the lines IF any are non-empty. Quiet-collapse when nothing
   * is actionable; the section is skipped entirely (no "all
   * systems nominal" noise). When `signals.hasCritical` is true,
   * the section header gets a `:rotating_light:` prefix so the
   * critical signal can't be missed.
   *
   * Caller (`/api/ops/daily-brief`) populates this via
   * `composeBriefSignals` from `src/lib/ops/brief-signals.ts`.
   */
  signals?: {
    lines: string[];
    hasCritical: boolean;
  };
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

export interface VendorMarginBriefSlice {
  generatedAt: string;
  source: { path: string; version: string | null };
  alerts: VendorMarginAlert[];
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
  // Patriotic brand voice — these messages are USA Gummies' own ops bot,
  // not a generic devops dashboard. The hour the brief fires is part of
  // the brand: morning rallies the troops, EOD bookkeeps the win.
  const kindLabel =
    input.kind === "morning"
      ? "USA GUMMIES — MORNING BRIEFING ⭐"
      : "USA GUMMIES — END-OF-DAY DEBRIEF ⭐";
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
      ? `🎯 *${pendingCount}* approval(s) on the runway in \`#ops-approvals\` — let's clear the deck.`
      : `✅ Approval queue is *clean*. Nothing blocking the line.`,
  );
  if (pausedCount > 0) {
    const agentList = input.pausedAgents.map((p) => `\`${p.agentId}\``).join(", ");
    priorities.push(`🛑 *${pausedCount}* agent(s) standing down — review needed: ${agentList}.`);
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*🎯 TODAY'S MISSION*\n${priorities.join("\n")}` },
  });

  // ---- Operational signals (Phase 32.1) ----
  // Aggregated from stack-readiness, agent-health, USPTO,
  // inbox-triage, inventory-reorder. Quiet-collapse: section is
  // omitted entirely when zero signals fired. Critical signals
  // (stack-down / agent-red / critical-USPTO / stale-inbox) get a
  // :rotating_light: header so they can't be missed at a glance.
  if (input.signals && input.signals.lines.length > 0) {
    const sectionHeader = input.signals.hasCritical
      ? ":rotating_light: *RED ALERT — HEADS UP*"
      : ":radio: *FRONT-LINE SIGNALS*";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${sectionHeader}\n${input.signals.lines.join("\n")}`,
      },
    });
  }

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
      text: { type: "mrkdwn", text: `💵 *YESTERDAY'S RING-UP*\n${rows}` },
    });
  }
  // Slim mode: suppress the "Revenue unavailable — not wired" filler line.
  // It posts every brief and never changes. Once integrations are wired,
  // the `if (input.revenue)` branch above will fire.

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
          text: `🏦 *WAR CHEST — BoA checking 7020*  *$${cp.amountUsd.toFixed(2)}*${src}`,
        },
      });
    } else if (cp.amountUsd != null && !hasValidSource) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🏦 *WAR CHEST — BoA checking 7020*  unavailable — amount=${cp.amountUsd} suppressed: missing source.system or source.retrievedAt (no-fabrication rule)`,
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🏦 *WAR CHEST — BoA checking 7020*  unavailable — ${cp.unavailableReason ?? "no reason given"}`,
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
  }
  // Slim mode: suppress the "AR unavailable — not wired" filler line.
  // It posts every brief and never changes. When the QBO AR query lands,
  // the `if (input.arPosition)` branch above will fire.

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

  // ---- Vendor margin watch (morning only) ----
  if (input.kind === "morning" && input.vendorMargin) {
    const vendorMarginText = renderVendorMarginMarkdown(input.vendorMargin);
    if (vendorMarginText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: vendorMarginText },
      });
    }
  }

  // ---- Off-grid pricing visibility (Phase 36.6, morning only) ----
  // Surfaces every quote / deal / invoice priced off the canonical B-tier
  // grid in the last 24h. Hard-block flag fires when any quote is below
  // the $2.12 minimum-margin floor. Quiet-collapses when zero off-grid.
  if (input.kind === "morning" && input.offGridQuotes) {
    const offGridText = renderOffGridQuotesMarkdown(input.offGridQuotes);
    if (offGridText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: offGridText },
      });
    }
  }

  // ---- Stale buyers (Phase D1 + D6, morning only) ----
  // Surfaces HubSpot deals whose lastActivityAt has aged past their
  // stage's threshold. Quiet-collapse when zero stale deals: the
  // section is omitted entirely. Skipped on EOD because the morning
  // surface is the action window for follow-up.
  if (input.kind === "morning" && input.staleBuyers) {
    const staleText = renderStaleBuyersMarkdown(input.staleBuyers);
    if (staleText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: staleText },
      });
    }
  }

  // ---- Sample queue health (Phase D2, morning only) ----
  // Awaiting-ship + shipped-awaiting-response counts. Complementary
  // to stale-buyers — surfaces the sample funnel pulse without
  // duplicating D1's per-deal callouts.
  if (input.kind === "morning" && input.sampleQueue) {
    const sqText = renderSampleQueueMarkdown(input.sampleQueue);
    if (sqText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: sqText },
      });
    }
  }

  // ---- Reorder follow-ups (Phase D4, morning only) ----
  // Amazon FBM 60d + wholesale 90d (Shopify DTC 90d in v0.2).
  // Quiet-collapses when no candidates across any channel.
  if (input.kind === "morning" && input.reorderFollowUps) {
    const reorderText = renderReorderFollowUpsMarkdown(input.reorderFollowUps);
    if (reorderText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: reorderText },
      });
    }
  }

  // ---- Wholesale onboarding blockers (Phase D3, morning only) ----
  // Stalled flows from the wholesale-onboarding KV store, projected
  // into a morning-glance line for Ben. The dedicated digest in
  // #finance (Phase 35.f.5.b) remains for Rene; this is the brief
  // companion. Quiet-collapse when zero stalled.
  if (input.kind === "morning" && input.onboardingBlockers) {
    const blockerText = renderOnboardingBlockersMarkdown(input.onboardingBlockers);
    if (blockerText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: blockerText },
      });
    }
  }

  // ---- Enrichment opportunities (Phase D5 v0.3, morning only) ----
  // Lightweight count of recent HubSpot contacts missing enrichable
  // fields. No Apollo calls happen here — the count is the surface;
  // the actual sweep is a separate operator action.
  if (input.kind === "morning" && input.enrichmentOpportunities) {
    const enrichText = renderEnrichmentOpportunitiesMarkdown(input.enrichmentOpportunities);
    if (enrichText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: enrichText },
      });
    }
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

  // ---- Daily P&L recap (EOD only) ----
  // Closes the loop on Day 1's morning revenue wiring. Yesterday's
  // top-line + COGS + fixed = net; MTD totals; monthly burn estimate
  // + runway. No-fabrication contract — see DailyPnlBriefSlice doc.
  if (input.kind === "eod" && input.dailyPnl) {
    const pnl = renderDailyPnlMarkdown(input.dailyPnl);
    if (pnl) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: pnl } });
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
      text: { type: "mrkdwn", text: `🛂 *APPROVAL QUEUE — by division*\n${lines}` },
    });
  }

  // ---- Activity (audit entries last 24h) ----
  // Slim mode: suppressed in the Slack brief. Ben said the "by-division"
  // counts ("production-supply-chain: 18") aren't actionable. Full audit
  // trail still lives in #ops-audit + the audit store.
  // (Block intentionally omitted — see ops-audit for raw activity.)
  const totalActivity = Object.values(activityByDivision).reduce((a, b) => a + b, 0);

  // ---- Active divisions roster ----
  // Slim mode: also suppressed — same 6-row block on every brief, zero
  // information value. Org chart lives in /contracts/divisions.json.

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
    `💸 *MONEY OWED TO US (sent invoices)*  ${renderARBucket(ar.outstanding)}`,
    `📝 *Drafts (not yet AR)*  ${renderARBucket(ar.drafts)}`,
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
  const lines: string[] = ["🛫 *SHIPPING HUB — PRE-FLIGHT CHECK*"];

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
    : "🛫 *SHIPPING HUB — PRE-FLIGHT CHECK*\n✅ All clear, wheels up — wallets above floor, ATP healthy, queue empty, no stale voids.";
}

function renderFulfillmentTodayMarkdown(ft: FulfillmentTodayBriefSlice): string {
  const lines: string[] = ["📦 *FULFILLMENT — TODAY'S OUTBOUND*"];

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
 * Render the EOD daily P&L recap. Quiet-collapses when every input
 * line is null (no Supabase data + no cash position).
 *
 * Output shape (one example, fully populated):
 *
 *   💵 *DAILY P&L — Yesterday (2026-05-03)*
 *   • Revenue: $XX.XX  ·  COGS [est]: -$YY.YY  ·  Fixed [est]: -$Z.ZZ
 *   • 🟢 Net: +$AA.AA
 *   *MTD:* Revenue $X,XXX.XX · Net +$YY.YY  _(may-2026 to-date)_
 *   • 🔥 Burn (30d est): -$X,XXX.XX  ·  ⏱ Runway: ~A.B months
 *   _Source: kpi_timeseries (revenue) + DAILY_FIXED $30/day estimate. Flip to QBO actuals once `qbo.bill.create.from-receipt` ships._
 */
function renderDailyPnlMarkdown(slice: DailyPnlBriefSlice): string {
  const lines: string[] = [];

  // Yesterday block.
  const y = slice.yesterday;
  if (y.revenueUsd === null && y.netUsd === null) {
    if (y.unavailableReason) {
      lines.push(
        `💵 *DAILY P&L — Yesterday (${slice.date})*`,
        `• unavailable — ${y.unavailableReason}`,
      );
    }
  } else {
    lines.push(`💵 *DAILY P&L — Yesterday (${slice.date})*`);
    const rev =
      y.revenueUsd === null ? "n/a" : `$${y.revenueUsd.toFixed(2)}`;
    const cogs =
      y.cogsUsdEstimated === null
        ? ""
        : ` · COGS [est]: -$${y.cogsUsdEstimated.toFixed(2)}`;
    const fixed =
      y.fixedCostsUsdEstimated === null
        ? ""
        : ` · Fixed [est]: -$${y.fixedCostsUsdEstimated.toFixed(2)}`;
    lines.push(`• Revenue: ${rev}${cogs}${fixed}`);
    if (y.netUsd !== null) {
      const emoji = y.netUsd >= 0 ? "🟢" : "🔴";
      const sign = y.netUsd >= 0 ? "+" : "-";
      lines.push(`• ${emoji} Net: ${sign}$${Math.abs(y.netUsd).toFixed(2)}`);
    }
  }

  // MTD block.
  const m = slice.mtd;
  if (m.revenueUsd !== null || m.netUsd !== null) {
    const rev =
      m.revenueUsd === null ? "n/a" : `$${m.revenueUsd.toFixed(2)}`;
    if (m.netUsd === null) {
      lines.push(`*MTD:* Revenue ${rev}`);
    } else {
      const emoji = m.netUsd >= 0 ? "🟢" : "🔴";
      const sign = m.netUsd >= 0 ? "+" : "-";
      lines.push(
        `*MTD:* Revenue ${rev} · ${emoji} Net ${sign}$${Math.abs(m.netUsd).toFixed(2)}`,
      );
    }
  }

  // Burn + runway. Only render the runway line when both inputs are
  // non-null — never fabricate from a partial signal.
  const burn = slice.monthlyBurnUsdEstimated;
  const runway = slice.runwayMonthsEstimated;
  if (burn !== null && runway !== null) {
    lines.push(
      `• 🔥 Burn (30d est): -$${burn.toFixed(2)} · ⏱ Runway: ~${runway.toFixed(1)} months`,
    );
  } else if (burn !== null) {
    lines.push(`• 🔥 Burn (30d est): -$${burn.toFixed(2)}`);
  }

  // Source citation footer.
  if (slice.source) {
    lines.push(
      `_Source: ${slice.source.system} (retrieved ${slice.source.retrievedAt})._`,
    );
  }

  return lines.length === 0 ? "" : lines.join("\n");
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
  const header = "🚀 *SALES COMMAND — TODAY'S PUSH*";
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

  if (slice.salesPipelineLine) {
    lines.push(`• ${slice.salesPipelineLine}`);
  }

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

export function renderVendorMarginMarkdown(
  slice: VendorMarginBriefSlice,
): string {
  if (slice.alerts.length === 0) return "";
  const lines = ["💰 *VENDOR MARGIN WATCH*"];
  for (const alert of slice.alerts.slice(0, 3)) {
    lines.push(
      `• ${alert.name}: ${formatMarginAlert(alert.marginAlert)} — ${alert.reason}; GP ${formatRange(alert.gpPct, "%")}; price ${formatMaybeUsd(alert.pricePerBagUsd)}`,
    );
  }
  lines.push(
    `_Source: ${slice.source.path}${slice.source.version ? ` ${slice.source.version}` : ""}_`,
  );
  return lines.join("\n");
}

function formatMarginAlert(alert: VendorMarginAlert["marginAlert"]): string {
  if (alert === "below_floor") return "*below floor*";
  if (alert === "thin") return "*thin*";
  if (alert === "unknown") return "*needs actuals*";
  return "healthy";
}

function formatRange(range: { min: number; max: number } | null, suffix: string): string {
  if (!range) return "_unknown_";
  if (range.min === range.max) return `${range.min}${suffix}`;
  return `${range.min}${suffix}-${range.max}${suffix}`;
}

function formatMaybeUsd(value: number | null): string {
  return value === null ? "_unknown_" : `$${value.toFixed(2)}`;
}

/** Format a wired count or render "not wired" for null. NEVER returns
 *  "0" for null; that would erase the difference between an empty
 *  queue and a missing source. */
function formatCount(value: number | null): string {
  return value === null ? "_not wired_" : `*${value}*`;
}

// ---------------------------------------------------------------------------
// Phase 36.6 — off-grid pricing visibility flag rendering
// ---------------------------------------------------------------------------

const OFF_GRID_TOP_N_IN_BRIEF = 5;
const OFF_GRID_SEVERITY_LABELS: Record<OffGridSeverity, string> = {
  below_floor: ":rotating_light: BELOW FLOOR",
  below_distributor_floor: ":warning: distributor band drift",
  between_grid_lines: ":information_source: between grid lines",
  above_grid: ":heavy_dollar_sign: above grid",
  approved_class_c: ":white_check_mark: Class-C approved",
};

/**
 * Phase 36.6 — render the off-grid quotes slice into Markdown for the
 * morning brief. Quiet-collapses to empty string when no off-grid quotes
 * (the composer skips the section in that case).
 *
 * Layout:
 *   *Off-grid pricing watch — N quote(s) flagged* _(window: last 24h, M evaluated)_
 *   :rotating_light: HARD BLOCK: 1 quote below $2.12 floor
 *   • BELOW FLOOR — ACME ($1.95/bag, −$0.55 vs $2.49 grid, 36 bags = −$19.80) [HubSpot 12345]
 *   • between grid lines — Beta Co ($3.10/bag, +$0.10 vs $3.00 grid, 100 bags = +$10) [HubSpot 67890]
 *   ...
 *   _Source: hubspot_deal × 4, booth_quote × 1_
 */
export function renderOffGridQuotesMarkdown(
  slice: OffGridQuotesBriefSlice,
): string {
  const total =
    slice.countsBySeverity.below_floor +
    slice.countsBySeverity.below_distributor_floor +
    slice.countsBySeverity.between_grid_lines +
    slice.countsBySeverity.above_grid +
    slice.countsBySeverity.approved_class_c;

  if (total === 0) return "";

  const lines: string[] = [];
  const flagWord = total === 1 ? "quote" : "quotes";
  lines.push(
    `*Off-grid pricing watch — ${total} ${flagWord} flagged* _(window: ${slice.windowDescription}, ${slice.candidatesEvaluated} evaluated)_`,
  );

  if (slice.hasHardBlock) {
    const blockN = slice.countsBySeverity.below_floor;
    lines.push(
      `:rotating_light: *HARD BLOCK*: ${blockN} ${blockN === 1 ? "quote" : "quotes"} below the $2.12 minimum-margin floor — Class C \`pricing.change\` ratification required to ship.`,
    );
  }

  for (const q of slice.topQuotes.slice(0, OFF_GRID_TOP_N_IN_BRIEF)) {
    lines.push(formatOffGridLine(q));
  }

  if (slice.topQuotes.length < total) {
    const more = total - slice.topQuotes.length;
    lines.push(`_+${more} more — see /ops/finance/off-grid for full list_`);
  }

  // Source breakdown (so Ben + Rene know where the drift came from)
  const bySource: Record<string, number> = {};
  for (const q of slice.topQuotes) {
    bySource[q.candidate.source] = (bySource[q.candidate.source] ?? 0) + 1;
  }
  const sourceLine = Object.entries(bySource)
    .map(([k, v]) => `${k} × ${v}`)
    .join(", ");
  if (sourceLine) lines.push(`_Source: ${sourceLine}_`);

  return lines.join("\n");
}

function formatOffGridLine(q: OffGridQuote): string {
  const sevLabel = OFF_GRID_SEVERITY_LABELS[q.severity];
  const devSign = q.deviationPerBagUsd >= 0 ? "+" : "−";
  const devText = `${devSign}$${Math.abs(q.deviationPerBagUsd).toFixed(2)}/bag`;
  const totalSign = q.totalDeviationUsd >= 0 ? "+" : "−";
  const totalText = `${totalSign}$${Math.abs(q.totalDeviationUsd).toFixed(2)}`;
  const dealRef = q.candidate.hubspotDealId
    ? ` [HubSpot ${q.candidate.hubspotDealId}]`
    : ` [${q.candidate.source}:${q.candidate.id}]`;
  return `• ${sevLabel} — *${q.candidate.customerName}* ($${q.candidate.pricePerBagUsd.toFixed(2)}/bag, ${devText} vs $${q.nearestGridPrice.toFixed(2)} grid · ${q.candidate.bagCount} bags = ${totalText})${dealRef}`;
}

/**
 * Phase D1 + D6 — render the stale-buyer slice into Markdown for the
 * morning brief. Quiet-collapses to empty string when no deals are
 * stale (the composer skips the section in that case).
 *
 * Layout:
 *   *Stale buyers — N deal(s) need follow-up* _(scanned X active deals)_
 *   • Lead — 12d — Indian Pueblo Stores — Send first-touch outreach
 *   • Sample Shipped — 14d — Bryce Glamp — Sample-followup email
 *   ...
 *   _Per-stage: Lead 3, Sample Shipped 2, Quote/PO Sent 1_
 */
/**
 * Brief-slim cap on the stale-buyers list. The full list lives at
 * `/ops/sales`; the brief only surfaces the top few + a tally so the
 * post stays scannable. Drops from 8 lines (which Ben said was
 * overwhelming) to 3 + a "+N more" footer.
 */
const STALE_BUYERS_TOP_N_IN_BRIEF = 3;

export function renderStaleBuyersMarkdown(slice: StaleBuyerSummary): string {
  if (slice.stalest.length === 0) return "";
  const totalStale = slice.staleByStage.reduce((s, x) => s + x.count, 0);
  const header = `🎯 *FOLLOW-UP HIT LIST — ${totalStale} deal(s) waiting on you* _(scanned ${slice.activeDealsScanned} active)_`;
  const lines: string[] = [header];
  const top = slice.stalest.slice(0, STALE_BUYERS_TOP_N_IN_BRIEF);
  for (const d of top) {
    const days = Number.isFinite(d.daysSinceActivity)
      ? `${d.daysSinceActivity}d`
      : "no activity";
    const company = d.primaryCompanyName
      ? d.primaryCompanyName
      : d.dealName.slice(0, 60);
    lines.push(`• \`${d.stageName}\` — ${days} — ${company} — _${d.nextAction}_`);
  }
  const remaining = slice.stalest.length - top.length;
  if (remaining > 0) {
    lines.push(`_…and ${remaining} more — full list at <https://www.usagummies.com/ops/sales|/ops/sales>_`);
  }
  if (slice.staleByStage.length > 0) {
    const perStage = slice.staleByStage
      .map((s) => `${s.stageName} ${s.count}`)
      .join(", ");
    lines.push(`_Per-stage: ${perStage}_`);
  }
  return lines.join("\n");
}

/**
 * Phase D2 — render the sample-queue-health slice.
 *
 * Quiet-collapses (returns "") when there are zero awaiting-ship
 * and zero shipped-awaiting-response deals.
 *
 * Layout:
 *   *Sample queue:* awaitingShip · awaitingShipBehind behind · shippedAwaitingResponse waiting on response
 *   _Oldest requested: Xd · Oldest shipped: Yd_
 */
export function renderSampleQueueMarkdown(slice: SampleQueueHealth): string {
  if (slice.awaitingShip === 0 && slice.shippedAwaitingResponse === 0) return "";

  const fmtDays = (n: number): string => (Number.isFinite(n) ? `${n}d` : "—");
  const lines: string[] = [];
  const headerParts: string[] = [];
  if (slice.awaitingShip > 0) {
    const behind =
      slice.awaitingShipBehind > 0
        ? ` · :rotating_light: ${slice.awaitingShipBehind} > ${slice.behindThresholdDays}d`
        : "";
    headerParts.push(`${slice.awaitingShip} awaiting ship${behind}`);
  }
  if (slice.shippedAwaitingResponse > 0) {
    headerParts.push(`${slice.shippedAwaitingResponse} shipped, waiting on buyer`);
  }
  lines.push(`📦 *SAMPLE PIPELINE:* ${headerParts.join(" · ")}`);

  // Aging tail line — only render when at least one bucket is non-zero.
  const tailParts: string[] = [];
  if (slice.awaitingShip > 0) {
    tailParts.push(`Oldest requested: ${fmtDays(slice.oldestRequestedDays)}`);
  }
  if (slice.shippedAwaitingResponse > 0) {
    tailParts.push(`Oldest shipped: ${fmtDays(slice.oldestShippedDays)}`);
  }
  if (tailParts.length > 0) {
    lines.push(`_${tailParts.join(" · ")}_`);
  }
  return lines.join("\n");
}

/**
 * Phase D4 — render the reorder-follow-ups slice.
 *
 * Quiet-collapses (returns "") when topCandidates is empty.
 *
 * Layout:
 *   *Reorder follow-ups — N candidate(s) past channel windows*
 *   • `wholesale` 92d — Mike Hippler / Thanksgiving Point — Move to Reorder stage + send check-in email
 *   • `amazon-fbm` 75d — Amy Catalano (WILOUGHBY HLS, OH) — Send Amazon FBM repeat-buyer thank-you...
 *   _Per-channel: wholesale 2 (90d), amazon-fbm 5 (60d)_
 */
export function renderReorderFollowUpsMarkdown(slice: ReorderFollowUpSummary): string {
  if (slice.topCandidates.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `🔁 *REORDER WINDOW IS OPEN — ${slice.total} buyer(s) ready for round 2*`,
  );
  for (const c of slice.topCandidates) {
    const extra = c.meta.extra ? ` (${c.meta.extra})` : "";
    lines.push(
      `• \`${c.channel}\` — ${c.daysSinceLastOrder}d — ${c.displayName}${extra} — _${c.nextAction}_`,
    );
  }
  if (slice.byChannel.length > 0) {
    const perChannel = slice.byChannel
      .map((b) => `${b.channel} ${b.count} (${b.windowDays}d)`)
      .join(", ");
    lines.push(`_Per-channel: ${perChannel}_`);
  }
  return lines.join("\n");
}

/**
 * Phase D3 — render the wholesale-onboarding-blockers slice.
 *
 * Quiet-collapses (returns "") when topBlockers is empty.
 *
 * Layout:
 *   *Wholesale onboarding stalled — N flow(s) past Xh*  _(scanned Y total)_
 *   • `payment-path` — 4d — Bryce Glamp & Camp ($3,141) — Call buyer to clarify CC vs AP
 *   • `ap-info` — 5d — Indian Pueblo Stores — Email buyer requesting AP contact + tax ID
 *   _Per-step: payment-path 1, ap-info 1_  ·  _Open: /ops/wholesale/onboarding_
 */
export function renderOnboardingBlockersMarkdown(
  slice: OnboardingBlockersSummary,
): string {
  if (slice.topBlockers.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `🚧 *ONBOARDING JAMMED UP — ${slice.stalledTotal} flow(s) parked past ${slice.stallHours}h* _(scanned ${slice.flowsScanned} total)_`,
  );
  for (const b of slice.topBlockers) {
    const dollars = b.totalSubtotalUsd
      ? ` ($${b.totalSubtotalUsd.toLocaleString("en-US")})`
      : "";
    lines.push(
      `• \`${b.currentStep}\` — ${b.daysSinceLastTouch}d — ${b.displayName}${dollars} — _${b.nextAction}_`,
    );
  }
  if (slice.byStep.length > 0) {
    const perStep = slice.byStep
      .map((s) => `${s.step} ${s.count}`)
      .join(", ");
    lines.push(
      `_Per-step: ${perStep}_  ·  _Open: <https://www.usagummies.com/ops/wholesale/onboarding|/ops/wholesale/onboarding>_`,
    );
  }
  return lines.join("\n");
}

/**
 * Phase D5 v0.3 — render the Apollo-enrichment-opportunities slice.
 *
 * Quiet-collapses (returns "") when missingAny=0 (everything filled).
 *
 * Layout:
 *   *Enrichment opportunities — N contacts missing fields*  _(scanned M)_
 *   _Top fields: jobtitle 12, phone 8, company 5_  ·  _Run: POST /api/ops/sales/apollo-enrich/sweep_
 */
export function renderEnrichmentOpportunitiesMarkdown(
  slice: EnrichmentOpportunitiesSummary,
): string {
  if (slice.missingAny === 0) return "";
  const lines: string[] = [];
  lines.push(
    `🔎 *INTEL UPGRADE — ${slice.missingAny} contact(s) missing fields, ready to enrich* _(scanned ${slice.scanned})_`,
  );
  if (slice.perField.length > 0) {
    const top = slice.perField
      .slice(0, 5)
      .map((p) => `${p.field} ${p.count}`)
      .join(", ");
    lines.push(
      `_Top fields: ${top}_  ·  _Sweep: \`POST /api/ops/sales/apollo-enrich/sweep\`_`,
    );
  }
  return lines.join("\n");
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
    lines.push(`🚚 *DISPATCH BOARD — last 24h*  ${parts.join(" · ")}`);
  }
  if (stale && slice.oldestOpenAgeDays !== null) {
    const dayWord = slice.oldestOpenAgeDays === 1 ? "day" : "days";
    lines.push(
      `:warning: *Oldest open package: ${slice.oldestOpenAgeDays} ${dayWord} on the cart* — past the 2-business-day handling promise; print + drop today.`,
    );
  }
  return lines.join("\n");
}
