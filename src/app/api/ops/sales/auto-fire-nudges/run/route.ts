/**
 * GET|POST /api/ops/sales/auto-fire-nudges/run
 *
 * Daily cron: pulls candidates from each detector (sample touch-2,
 * reorder-offer, onboarding-nudge), resolves buyer email per source,
 * and fires the matching propose endpoint for each top-N candidate.
 * Each fire opens its OWN Class B `gmail.send` approval card in
 * #ops-approvals — Ben taps Approve per buyer.
 *
 * Closes the loop on the 3 propose routes (commits 5cf2e4d5 + e42d5707):
 * the cards exist, but they had no auto-source. Today's morning brief
 * surfaces "send DTC reorder offer to Vicki Williams ($51 lifetime)"
 * daily for 95+ days; this orchestrator is what actually queues the
 * approval card so Ben can tap once and ship.
 *
 * Hard guardrails:
 *   • Per-detector cap (default 3 per run) so one bad query doesn't
 *     spam #ops-approvals with 50 cards.
 *   • Total-fire cap (default 8) across all detectors as a backstop.
 *   • Skip-list (KV-backed, kind-specific TTL) so a single buyer
 *     can't get the same nudge fired twice within the cooldown.
 *   • Each propose call is a fresh fetch to the existing route —
 *     fail-soft per-candidate (one bad email doesn't break the rest).
 *   • Dry-run mode (`?dryRun=true`) returns the candidate list +
 *     resolved emails without creating Gmail drafts or approval cards.
 *
 * Auth: bearer CRON_SECRET (cron-only path).
 */
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { record } from "@/lib/ops/control-plane/record";
import { HUBSPOT, listRecentDeals } from "@/lib/ops/hubspot-client";
import { listAmazonCustomers } from "@/lib/ops/amazon-customers";
import { listShopifyCustomersWithLastOrder } from "@/lib/shopify/customers-with-last-order";
import { listRecentFlows } from "@/lib/wholesale/onboarding-store";
import {
  classifyShopifyReorderCandidates,
  classifyWholesaleReorderCandidates,
  summarizeReorderFollowUps,
  type ReorderCandidate,
} from "@/lib/sales/reorder-followup";
import {
  summarizeOnboardingBlockers,
  type OnboardingBlocker,
} from "@/lib/sales/onboarding-blockers";
import {
  loadShopifyCustomerLookup,
  resolveHubSpotDealBuyer,
  resolveOnboardingFlowBuyer,
  resolveShopifyCustomerBuyer,
  type ResolvedBuyer,
} from "@/lib/sales/auto-fire/buyer-email-resolver";
import {
  markNudged,
  wasNudgedRecently,
  type NudgeKind,
} from "@/lib/sales/auto-fire/skip-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — orchestrator iterates 8+ candidates

const STAGE_SAMPLE_SHIPPED = "3017718464";
const SAMPLE_TOUCH_2_DAYS = 7;

const DEFAULT_PER_DETECTOR_MAX = 3;
const DEFAULT_TOTAL_MAX = 8;

interface FireResult {
  kind: NudgeKind;
  candidateId: string;
  buyerEmail?: string;
  displayName?: string;
  status:
    | "fired"
    | "fired-dry-run"
    | "skipped-recently-nudged"
    | "skipped-no-email"
    | "skipped-cap-reached"
    | "fired-but-propose-failed";
  approvalId?: string;
  error?: string;
}

interface RunResult {
  ok: boolean;
  asOf: string;
  dryRun: boolean;
  totals: {
    perDetectorMax: number;
    totalMax: number;
    fired: number;
    skipped: number;
    failed: number;
  };
  perDetector: Record<NudgeKind, { eligible: number; fired: number }>;
  results: FireResult[];
  degraded: string[];
}

function getBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://www.usagummies.com";
}

/**
 * Fire a single propose endpoint and return the FireResult. Fail-soft —
 * a network error per-candidate is logged but doesn't break the run.
 */
async function fireProposeRoute(
  fetchImpl: typeof fetch,
  path: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; approvalId?: string; error?: string }> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify(payload),
    });
    let body: { ok?: boolean; approvalId?: string; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        error:
          body?.error ?? `propose route returned HTTP ${res.status}`,
      };
    }
    return { ok: true, approvalId: body.approvalId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface OrchestratorOpts {
  perDetectorMax: number;
  totalMax: number;
  dryRun: boolean;
  fetchImpl: typeof fetch;
}

async function runOrchestrator(
  opts: OrchestratorOpts,
): Promise<RunResult> {
  const asOf = new Date();
  const degraded: string[] = [];
  const results: FireResult[] = [];
  const perDetector: RunResult["perDetector"] = {
    "sample-touch-2": { eligible: 0, fired: 0 },
    "reorder-offer": { eligible: 0, fired: 0 },
    "onboarding-nudge": { eligible: 0, fired: 0 },
  };
  let totalFired = 0;

  // Helper — process a candidate of a given kind. Honors the caps,
  // skip-list, and per-buyer email resolution. Mutates `results`,
  // `perDetector`, and `totalFired`.
  async function tryFire(
    kind: NudgeKind,
    candidateId: string,
    buyer: ResolvedBuyer,
    proposePath: string,
    proposePayload: Record<string, unknown>,
  ): Promise<void> {
    if (totalFired >= opts.totalMax) {
      results.push({
        kind,
        candidateId,
        buyerEmail: buyer.email,
        displayName: buyer.displayName,
        status: "skipped-cap-reached",
      });
      return;
    }
    if (perDetector[kind].fired >= opts.perDetectorMax) {
      results.push({
        kind,
        candidateId,
        buyerEmail: buyer.email,
        displayName: buyer.displayName,
        status: "skipped-cap-reached",
      });
      return;
    }
    const recently = await wasNudgedRecently(kind, buyer.email);
    if (recently) {
      results.push({
        kind,
        candidateId,
        buyerEmail: buyer.email,
        displayName: buyer.displayName,
        status: "skipped-recently-nudged",
      });
      return;
    }

    if (opts.dryRun) {
      results.push({
        kind,
        candidateId,
        buyerEmail: buyer.email,
        displayName: buyer.displayName,
        status: "fired-dry-run",
      });
      totalFired += 1;
      perDetector[kind].fired += 1;
      return;
    }

    const fired = await fireProposeRoute(
      opts.fetchImpl,
      proposePath,
      proposePayload,
    );
    if (!fired.ok) {
      results.push({
        kind,
        candidateId,
        buyerEmail: buyer.email,
        displayName: buyer.displayName,
        status: "fired-but-propose-failed",
        error: fired.error,
      });
      return;
    }
    await markNudged(kind, buyer.email);
    results.push({
      kind,
      candidateId,
      buyerEmail: buyer.email,
      displayName: buyer.displayName,
      status: "fired",
      approvalId: fired.approvalId,
    });
    totalFired += 1;
    perDetector[kind].fired += 1;
  }

  // ---- Detector 1: sample-touch-2 ----
  // Source: HubSpot deals at stage Sample Shipped with
  // daysSinceLastActivity > 7. We don't try to detect "buyer replied"
  // here (that requires Gmail thread cross-ref); the existing brief's
  // `alreadyEngaged` signal is the next-pass enhancement. Skip-list
  // covers the "we already nudged this buyer" duplicate case.
  let recentDeals: Awaited<ReturnType<typeof listRecentDeals>> = [];
  try {
    recentDeals = await listRecentDeals({ limit: 200 });
  } catch (err) {
    degraded.push(
      `listRecentDeals failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const sampleShippedCandidates = recentDeals
    .filter(
      (d) =>
        d.dealstage === STAGE_SAMPLE_SHIPPED &&
        d.daysSinceLastActivity > SAMPLE_TOUCH_2_DAYS,
    )
    .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity)
    .slice(0, opts.perDetectorMax * 2); // headroom for null-resolves

  perDetector["sample-touch-2"].eligible = sampleShippedCandidates.length;

  for (const deal of sampleShippedCandidates) {
    if (perDetector["sample-touch-2"].fired >= opts.perDetectorMax) break;
    if (totalFired >= opts.totalMax) break;
    const buyer = await resolveHubSpotDealBuyer(deal.id);
    if (!buyer) {
      results.push({
        kind: "sample-touch-2",
        candidateId: deal.id,
        status: "skipped-no-email",
      });
      continue;
    }
    await tryFire(
      "sample-touch-2",
      deal.id,
      buyer,
      "/api/ops/sales/sample-touch-2/propose",
      {
        hubspotDealId: deal.id,
        buyerEmail: buyer.email,
        buyerFirstName: buyer.firstName,
        displayName: buyer.displayName,
        daysSinceShipped: deal.daysSinceLastActivity,
        sources: [
          {
            system: "hubspot:deal",
            id: deal.id,
          },
        ],
      },
    );
  }

  // ---- Detector 2: reorder-offer (wholesale + Shopify DTC) ----
  // Amazon FBM is intentionally excluded — no outbound email path.
  let wholesaleCandidates: ReorderCandidate[] = [];
  let shopifyCandidates: ReorderCandidate[] = [];
  let shopifyLookup: Awaited<ReturnType<typeof loadShopifyCustomerLookup>>;
  try {
    shopifyLookup = await loadShopifyCustomerLookup();
  } catch (err) {
    shopifyLookup = new Map();
    degraded.push(
      `loadShopifyCustomerLookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Wholesale reorder candidates use the same recent-deals fetch
  // we already pulled above. Adapt PipelineDeal → HubSpotDealForStaleness
  // shape (the classifier expects pipelineId / stageId / lastActivityAt).
  try {
    const wholesaleInput = recentDeals.map((d) => ({
      id: d.id,
      dealname: d.dealname,
      pipelineId: HUBSPOT.PIPELINE_B2B_WHOLESALE,
      stageId: d.dealstage,
      lastActivityAt: d.lastmodifieddate || d.createdate || null,
      primaryContactId: null,
      primaryCompanyName: null,
    }));
    wholesaleCandidates = classifyWholesaleReorderCandidates(
      wholesaleInput,
      asOf,
    );
  } catch (err) {
    degraded.push(
      `classifyWholesaleReorder failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Shopify DTC reorder candidates from the lookup table.
  try {
    const shopifyInput = Array.from(shopifyLookup.values())
      .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
      .map((c) => ({
        numericId: c.numericId,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        ordersCount: c.ordersCount,
        lastOrderAt: c.lastOrderAt,
        totalSpentUsd: c.totalSpentUsd,
      }));
    shopifyCandidates = classifyShopifyReorderCandidates(shopifyInput, asOf);
  } catch (err) {
    degraded.push(
      `classifyShopifyReorder failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const reorderSummary = summarizeReorderFollowUps({
    amazonCandidates: [],
    wholesaleCandidates,
    shopifyCandidates,
    now: asOf,
    sources: [
      { system: "hubspot", retrievedAt: asOf.toISOString() },
      { system: "shopify-admin", retrievedAt: asOf.toISOString() },
    ],
    topN: opts.perDetectorMax * 3, // headroom for null-resolves
  });

  perDetector["reorder-offer"].eligible = reorderSummary.total;

  for (const c of reorderSummary.topCandidates) {
    if (perDetector["reorder-offer"].fired >= opts.perDetectorMax) break;
    if (totalFired >= opts.totalMax) break;
    if (c.channel === "amazon-fbm") continue; // no outbound email path
    let buyer: ResolvedBuyer | null = null;
    if (c.channel === "wholesale") {
      const dealId = c.id.startsWith("hubspot-deal:")
        ? c.id.slice("hubspot-deal:".length)
        : c.id;
      buyer = await resolveHubSpotDealBuyer(dealId);
    } else if (c.channel === "shopify-dtc") {
      const customerKey = c.id.startsWith("shopify-customer:")
        ? c.id.slice("shopify-customer:".length)
        : c.id;
      buyer = resolveShopifyCustomerBuyer(customerKey, shopifyLookup);
    }
    if (!buyer) {
      results.push({
        kind: "reorder-offer",
        candidateId: c.id,
        status: "skipped-no-email",
      });
      continue;
    }
    await tryFire(
      "reorder-offer",
      c.id,
      buyer,
      "/api/ops/sales/reorder-offer/propose",
      {
        channel: c.channel,
        candidateId: c.id,
        buyerEmail: buyer.email,
        buyerFirstName: buyer.firstName,
        displayName: buyer.displayName,
        daysSinceLastOrder: c.daysSinceLastOrder,
        windowDays: c.windowDays,
        // Discount code intentionally omitted — caller-supplied only.
        // Future: resolve from a Shopify discount-codes pool when we
        // have one wired (Class D `pricing.discount.rule.change`
        // gates the auto-discount path).
        sources: [
          {
            system: c.channel === "wholesale" ? "hubspot:deal" : "shopify-admin:customer",
            id: c.id,
          },
        ],
      },
    );
  }

  // ---- Detector 3: onboarding-nudge ----
  let onboardingFlows: Awaited<ReturnType<typeof listRecentFlows>> = [];
  try {
    onboardingFlows = await listRecentFlows({ limit: 100 });
  } catch (err) {
    degraded.push(
      `listRecentFlows failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let onboardingSummary: ReturnType<typeof summarizeOnboardingBlockers>;
  try {
    onboardingSummary = summarizeOnboardingBlockers(
      onboardingFlows,
      asOf,
      asOf.toISOString(),
      { topN: opts.perDetectorMax * 2, stallHours: 24 },
    );
  } catch (err) {
    degraded.push(
      `summarizeOnboardingBlockers failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    onboardingSummary = {
      asOf: asOf.toISOString(),
      topBlockers: [] as OnboardingBlocker[],
      byStep: [],
      flowsScanned: 0,
      stalledTotal: 0,
      stallHours: 24,
      source: { system: "wholesale-onboarding-kv", retrievedAt: asOf.toISOString() },
    };
  }

  perDetector["onboarding-nudge"].eligible =
    onboardingSummary.stalledTotal;

  for (const blocker of onboardingSummary.topBlockers) {
    if (perDetector["onboarding-nudge"].fired >= opts.perDetectorMax) break;
    if (totalFired >= opts.totalMax) break;
    const buyer = await resolveOnboardingFlowBuyer(blocker.flowId);
    if (!buyer) {
      results.push({
        kind: "onboarding-nudge",
        candidateId: blocker.flowId,
        status: "skipped-no-email",
      });
      continue;
    }
    const onboardingUrl = `${getBaseUrl()}/onboarding/${blocker.flowId}`;
    await tryFire(
      "onboarding-nudge",
      blocker.flowId,
      buyer,
      "/api/ops/sales/onboarding-nudge/propose",
      {
        flowId: blocker.flowId,
        buyerEmail: buyer.email,
        buyerFirstName: buyer.firstName,
        displayName: buyer.displayName,
        currentStep: blocker.currentStep,
        daysSinceLastTouch: blocker.daysSinceLastTouch,
        onboardingUrl,
        hubspotDealId: blocker.hubspotDealId,
        sources: [
          {
            system: "wholesale-onboarding-kv",
            id: blocker.flowId,
          },
        ],
      },
    );
  }

  // ---- Audit envelope per run ----
  const fired = results.filter((r) => r.status === "fired" || r.status === "fired-dry-run").length;
  const skipped = results.filter((r) => r.status.startsWith("skipped-")).length;
  const failed = results.filter((r) => r.status === "fired-but-propose-failed").length;

  if (!opts.dryRun) {
    const run = newRunContext({
      agentId: "auto-fire-nudges",
      division: "sales",
      source: "scheduled",
      trigger: `auto-fire-nudges:${asOf.toISOString().slice(0, 10)}`,
    });
    await record(run, {
      actionSlug: "brief.publish",
      entityType: "auto-fire-nudges-run",
      entityId: asOf.toISOString().slice(0, 10),
      result: degraded.length > 0 || failed > 0 ? "ok" : "ok",
      after: {
        fired,
        skipped,
        failed,
        perDetector,
        degraded,
      },
      sourceCitations: [
        {
          system: "hubspot",
          id: `recent-deals-${recentDeals.length}`,
        },
      ],
      confidence: 1.0,
    }).catch(() => void 0);
  }

  return {
    ok: true,
    asOf: asOf.toISOString(),
    dryRun: opts.dryRun,
    totals: {
      perDetectorMax: opts.perDetectorMax,
      totalMax: opts.totalMax,
      fired,
      skipped,
      failed,
    },
    perDetector,
    results,
    degraded,
  };
}

function parseOpts(req: Request): OrchestratorOpts {
  const url = new URL(req.url);
  const perDetectorMax = Math.max(
    1,
    Math.min(
      10,
      Number.parseInt(url.searchParams.get("perDetectorMax") ?? "", 10) ||
        DEFAULT_PER_DETECTOR_MAX,
    ),
  );
  const totalMax = Math.max(
    1,
    Math.min(
      30,
      Number.parseInt(url.searchParams.get("totalMax") ?? "", 10) ||
        DEFAULT_TOTAL_MAX,
    ),
  );
  const dryRun = url.searchParams.get("dryRun") === "true";
  return {
    perDetectorMax,
    totalMax,
    dryRun,
    fetchImpl: globalThis.fetch,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const result = await runOrchestrator(parseOpts(req));
  return NextResponse.json(result);
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const result = await runOrchestrator(parseOpts(req));
  return NextResponse.json(result);
}

export const __INTERNAL_FOR_TESTS = {
  runOrchestrator,
  parseOpts,
};

// listAmazonCustomers is imported above to keep the symbol referenced
// for future Amazon FBM in-app nudge flows; Amazon outbound email is
// excluded today (no Amazon ToS-compliant path).
void listAmazonCustomers;
