/**
 * Daily brief endpoint.
 *
 * Blueprint §15.4 W3a. Called by a Make.com scenario (or any scheduler)
 * twice a day: 7 AM PT (morning) and 6 PM PT (end-of-day). Posts the
 * composed brief to #ops-daily via the control-plane Slack client and
 * returns the rendered brief JSON.
 *
 * Auth: bearer CRON_SECRET.
 * Scheduler: Ben wires Make.com separately per /ops/blocked-items.md.
 *
 * Scope — day-one: control-plane state is authoritative; external
 * revenue/cash integrations are NOT wired by this route yet. When those
 * integrations are added (separate commit), they pass their data into
 * composeDailyBrief via BriefInput.revenueYesterday and cashPosition.
 * Until then, the brief renders "unavailable" lines for those fields
 * rather than fabricating numbers.
 */

import { NextResponse } from "next/server";

import {
  composeDailyBrief,
  type ARPosition,
  type BriefKind,
  type FulfillmentPreflightSlice,
  type FulfillmentTodayBriefSlice,
  type RevenueLine,
} from "@/lib/ops/control-plane/daily-brief";
import { computeFulfillmentPreflight } from "@/lib/ops/fulfillment-preflight";
import { computeFulfillmentTodaySlice } from "@/lib/ops/fulfillment-today";
import {
  composeSalesCommandSlice,
  type SalesCommandSlice,
} from "@/lib/ops/sales-command-center";
import {
  readApPackets,
  readFaireFollowUps,
  readFaireInvites,
  readLocationDrafts,
  readPendingApprovals,
  readWholesaleInquiries,
} from "@/lib/ops/sales-command-readers";
import { listDivisions } from "@/lib/ops/control-plane/divisions";
import { getChannel } from "@/lib/ops/control-plane/channels";
import {
  approvalStore,
  auditStore,
  pauseSink,
} from "@/lib/ops/control-plane/stores";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  getBalances,
  isPlaidConfigured,
  isPlaidConnected,
} from "@/lib/finance/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BriefBodyOverrides {
  /**
   * Caller-supplied revenue lines. Each line either has `amountUsd` with
   * a `source` or an `unavailableReason`. See daily-brief.ts RevenueLine.
   * Typical source: a Make.com scenario that polled Shopify/Amazon/Faire
   * upstream and forwarded the result here. Refusing to fabricate is the
   * contract — callers MUST provide a source when amountUsd is non-null.
   */
  revenueYesterday?: RevenueLine[];
  /**
   * Cash position override. If omitted, the route tries Plaid directly.
   * Supply when Make.com pre-fetched or when Plaid is being rotated.
   */
  cashPosition?: {
    amountUsd: number | null;
    unavailableReason?: string;
    source?: { system: string; retrievedAt: string };
  };
  /**
   * AR position — two buckets per the 2026-03-30 Ben correction.
   * `outstanding` = sent invoices with open balance (the only bucket
   * that counts as AR). `drafts` = unsent invoices (NOT AR; reported
   * separately). Each bucket is an ARBucket following the same
   * no-fabrication contract as revenueYesterday / cashPosition.
   */
  arPosition?: ARPosition;
}

export async function POST(req: Request): Promise<Response> {
  return composeAndPost(req);
}

/**
 * GET handler for Vercel Cron. Vercel Cron triggers a bearer-authenticated
 * GET request; it cannot send a POST body. GET uses only the query-string
 * params (`kind`, `post`) — revenue/cash overrides are not available from a
 * cron trigger, so the brief renders "unavailable" for those lines unless
 * they can be resolved server-side (Plaid live fetch for cash position).
 *
 * Make.com scenarios should continue to use POST with the JSON override
 * body when they have pre-fetched revenue data.
 */
export async function GET(req: Request): Promise<Response> {
  return composeAndPost(req);
}

async function composeAndPost(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: BriefKind = kindParam === "eod" ? "eod" : "morning";
  const postToSlack = url.searchParams.get("post") !== "false";

  // Optional JSON body with caller-supplied revenue / cash overrides.
  // Every amountUsd != null MUST carry { source.system, source.retrievedAt }
  // per the contract in ops/make-webhooks.md §5 — no naked numbers through.
  let overrides: BriefBodyOverrides = {};
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      const raw = await req.text();
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as unknown;
        const validated = validateOverrides(parsed);
        if (!validated.ok) {
          return NextResponse.json(
            {
              error: "Invalid override body",
              reason:
                "Every amountUsd != null must include source.system and source.retrievedAt. Every null amountUsd must include unavailableReason.",
              problems: validated.problems,
            },
            { status: 400 },
          );
        }
        overrides = validated.overrides;
      }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const now = new Date();
  const degradations: string[] = [];

  // ---- Gather control-plane state ----
  let pendingApprovals: Awaited<ReturnType<ReturnType<typeof approvalStore>["listPending"]>> = [];
  try {
    pendingApprovals = await approvalStore().listPending();
  } catch (err) {
    degradations.push(
      `approval store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let pausedAgents: Awaited<ReturnType<ReturnType<typeof pauseSink>["listPaused"]>> = [];
  try {
    pausedAgents = await pauseSink().listPaused();
  } catch (err) {
    degradations.push(
      `pause sink unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let recentAudit: Awaited<ReturnType<ReturnType<typeof auditStore>["recent"]>> = [];
  try {
    recentAudit = await auditStore().recent(500);
  } catch (err) {
    degradations.push(
      `audit store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Use the dedicated per-action index so the latest weekly scorecard
  // is always found regardless of audit volume. Previously we scanned
  // recent(500) and filtered, which silently dropped the last summary
  // once volume grew past the window.
  let lastDriftAuditSummary: string | undefined;
  try {
    const [last] = await auditStore().byAction("drift-audit.scorecard", 1);
    if (last && typeof last.after === "string") {
      lastDriftAuditSummary = last.after;
    }
  } catch {
    // audit store unavailability already captured above
  }

  // ---- Divisions ----
  const activeDivisions = listDivisions("active").map((d) => ({
    id: d.id,
    name: d.name,
    humanOwner: d.humanOwner,
  }));

  // ---- Resolve cash position ----
  //
  // Priority: caller-supplied override > live Plaid fetch > unavailable
  // with a specific reason. We never fabricate a number. Plaid is the
  // only external join currently wired server-side because it's the
  // only one with a safe, proven in-repo helper (see /api/ops/plaid/
  // balance for the existing pattern). All other revenue joins are
  // caller-supplied via the request body per ops/make-webhooks.md.
  const cashPosition = overrides.cashPosition ?? (await resolvePlaidCashPosition());

  // Shipping Hub pre-flight — morning brief only. Ben's 08:00 PT read
  // in #ops-daily surfaces wallet/ATP/queue/stale-voids so he knows
  // before the 10:00 PT Ops Agent post whether shipping is gated.
  //
  // Skipped entirely when ShipStation + Amazon creds aren't set (test
  // env / dev). Silent failures during the fetch also don't taint the
  // envelope — only a real throw bubbles into degradations.
  let preflight: FulfillmentPreflightSlice | undefined;
  const shipStationConfigured = !!process.env.SHIPSTATION_API_KEY?.trim();
  if (kind === "morning" && shipStationConfigured) {
    try {
      const pf = await computeFulfillmentPreflight();
      preflight = {
        walletAlerts: pf.wallets
          .filter((w) => w.belowFloor)
          .map((w) => ({
            carrierCode: w.carrierCode,
            balance: w.balance,
            floor: w.floor,
          })),
        atp: pf.atp,
        freightCompQueue: {
          queuedCount: pf.freightCompQueue.queuedCount,
          queuedDollars: pf.freightCompQueue.queuedDollars,
        },
        staleVoids: {
          count: pf.staleVoids.count,
          pendingDollars: pf.staleVoids.pendingDollars,
        },
        amazonFbm: pf.amazonFbm,
        alerts: pf.alerts,
      };
    } catch (err) {
      degradations.push(
        `preflight: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Morning brief only: compact Sales Command summary. Phase 2 of
  // the /ops/sales dashboard — same readers, projected down to a
  // ~6-line slice that lives in the morning #ops-daily post instead
  // of a separate noisy digest. Skipped on EOD because the
  // cumulative dashboard is what closes the loop.
  let salesCommand: SalesCommandSlice | undefined;
  if (kind === "morning") {
    try {
      const [
        faireInvites,
        faireFollowUps,
        pendingApprovalsForSales,
        apPackets,
        locationDrafts,
      ] = await Promise.all([
        readFaireInvites(),
        readFaireFollowUps(now),
        readPendingApprovals(),
        readApPackets(),
        readLocationDrafts(),
      ]);
      salesCommand = composeSalesCommandSlice({
        faireInvites,
        faireFollowUps,
        pendingApprovals: pendingApprovalsForSales,
        apPackets,
        locationDrafts,
        wholesaleInquiries: readWholesaleInquiries(),
      });
    } catch (err) {
      degradations.push(
        `sales-command: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // EOD brief only: today's fulfillment activity (labels bought,
  // voided, freight-comp queue transitions since midnight PT).
  let fulfillmentToday: FulfillmentTodayBriefSlice | undefined;
  if (kind === "eod") {
    try {
      const slice = await computeFulfillmentTodaySlice(now);
      for (const d of slice.degraded) degradations.push(`fulfillment-today: ${d}`);
      fulfillmentToday = {
        sinceIso: slice.sinceIso,
        labelsBought: slice.labelsBought,
        labelsVoided: slice.labelsVoided,
        freightCompQueue: slice.freightCompQueue,
      };
    } catch (err) {
      degradations.push(
        `fulfillment-today: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const composeInput = {
    kind,
    asOf: now,
    activeDivisions,
    pendingApprovals,
    pausedAgents,
    recentAudit,
    lastDriftAuditSummary,
    revenueYesterday: overrides.revenueYesterday,
    cashPosition,
    arPosition: overrides.arPosition,
    preflight,
    fulfillmentToday,
    salesCommand,
    degradations,
  } as const;
  let brief = composeDailyBrief(composeInput);

  // ---- Post to Slack ----
  //
  // If post=true and the Slack post either errors OR lands in degraded mode
  // (bot token absent), the envelope must reflect that the brief was NOT
  // delivered — not silently green. Blueprint non-negotiable #6: connector
  // failure forces degraded-mode disclosure, not invented certainty.
  let postResult: {
    ok: boolean;
    ts?: string;
    error?: string;
    degraded?: boolean;
  } | null = null;
  if (postToSlack) {
    const channel = getChannel("ops-daily")?.name ?? "#ops-daily";
    const res = await postMessage({ channel, text: brief.text, blocks: brief.blocks });
    postResult = { ok: res.ok, ts: res.ts, error: res.error, degraded: res.degraded };
    if (!res.ok) {
      const prefix = res.degraded ? "Slack post skipped" : "Slack post failed";
      const reason = res.error ?? (res.degraded ? "SLACK_BOT_TOKEN not configured" : "unknown Slack error");
      degradations.push(`${prefix}: ${reason}`);
      // Re-compose so the returned body matches the final degraded state.
      // Without this, the caller would get the pre-failure (healthy-looking)
      // text/blocks even though degradedReasons lists the delivery failure.
      brief = composeDailyBrief({ ...composeInput, degradations });
    }
  }

  // Envelope-level `degraded` aggregates every degradation we detected:
  // store unavailability (which also got surfaced inside the brief body)
  // plus delivery failure. If either is true, the response is not healthy.
  const envelopeDegraded = degradations.length > 0;

  return NextResponse.json({
    ok: true,
    degraded: envelopeDegraded,
    degradedReasons: degradations,
    brief: {
      meta: { ...brief.meta, degraded: envelopeDegraded },
      text: brief.text,
      blocks: brief.blocks,
    },
    post: postResult,
  });
}

// ---- Override validation --------------------------------------------------
//
// Enforces the daily-brief source contract at the route boundary. Every
// revenue line and the cash position either carries a real amount with
// { source.system, source.retrievedAt } OR amountUsd:null with an
// unavailableReason. No naked numbers.

interface ValidatedOverrides {
  ok: true;
  overrides: BriefBodyOverrides;
}
interface InvalidOverrides {
  ok: false;
  problems: string[];
}

function validateOverrides(raw: unknown): ValidatedOverrides | InvalidOverrides {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, problems: ["body must be a JSON object"] };
  }
  const body = raw as Record<string, unknown>;
  const problems: string[] = [];

  const revenueYesterday = body.revenueYesterday;
  if (revenueYesterday !== undefined) {
    if (!Array.isArray(revenueYesterday)) {
      problems.push("revenueYesterday must be an array when supplied");
    } else {
      revenueYesterday.forEach((line, i) => {
        validateRevenueLine(line, i, problems);
      });
    }
  }

  const cashPosition = body.cashPosition;
  if (cashPosition !== undefined) {
    validateCashPosition(cashPosition, problems);
  }

  const arPosition = body.arPosition;
  if (arPosition !== undefined) {
    validateARPosition(arPosition, problems);
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, overrides: body as BriefBodyOverrides };
}

function validateRevenueLine(line: unknown, i: number, problems: string[]): void {
  const here = `revenueYesterday[${i}]`;
  if (line === null || typeof line !== "object") {
    problems.push(`${here}: must be an object`);
    return;
  }
  const l = line as Record<string, unknown>;
  if (typeof l.channel !== "string" || l.channel.trim() === "") {
    problems.push(`${here}: channel must be a non-empty string`);
  }
  const amount = l.amountUsd;
  if (amount === undefined) {
    problems.push(`${here}: amountUsd is required (number | null)`);
    return;
  }
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
    problems.push(`${here}: amountUsd must be a finite number or null`);
    return;
  }
  if (amount === null) {
    if (typeof l.unavailableReason !== "string" || l.unavailableReason.trim() === "") {
      problems.push(`${here}: amountUsd is null so unavailableReason is required (non-empty string)`);
    }
    return;
  }
  // amount is a real number — source MUST be present + well-formed.
  const source = l.source;
  if (source === undefined || source === null || typeof source !== "object") {
    problems.push(`${here}: amountUsd=${amount} but source is missing. Every non-null amount requires source.`);
    return;
  }
  const s = source as Record<string, unknown>;
  if (typeof s.system !== "string" || s.system.trim() === "") {
    problems.push(`${here}: source.system must be a non-empty string`);
  }
  if (typeof s.retrievedAt !== "string" || s.retrievedAt.trim() === "") {
    problems.push(`${here}: source.retrievedAt must be a non-empty string (ISO 8601)`);
  }
}

function validateARPosition(pos: unknown, problems: string[]): void {
  const here = "arPosition";
  if (pos === null || typeof pos !== "object") {
    problems.push(`${here}: must be an object with outstanding + drafts buckets`);
    return;
  }
  const p = pos as Record<string, unknown>;
  if (p.outstanding === undefined) {
    problems.push(`${here}.outstanding: required (sent-only AR bucket)`);
  } else {
    validateARBucket(p.outstanding, `${here}.outstanding`, problems);
  }
  if (p.drafts === undefined) {
    problems.push(`${here}.drafts: required (unsent-drafts bucket; NOT AR)`);
  } else {
    validateARBucket(p.drafts, `${here}.drafts`, problems);
  }
}

function validateARBucket(bucket: unknown, here: string, problems: string[]): void {
  if (bucket === null || typeof bucket !== "object") {
    problems.push(`${here}: must be an object with amountUsd + count + source|unavailableReason`);
    return;
  }
  const b = bucket as Record<string, unknown>;
  const amount = b.amountUsd;
  const count = b.count;
  if (amount === undefined) {
    problems.push(`${here}: amountUsd is required (number | null)`);
    return;
  }
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
    problems.push(`${here}: amountUsd must be a finite number or null`);
    return;
  }
  if (count === undefined) {
    problems.push(`${here}: count is required (integer | null)`);
    return;
  }
  if (count !== null && (typeof count !== "number" || !Number.isInteger(count) || count < 0)) {
    problems.push(`${here}: count must be a non-negative integer or null`);
    return;
  }
  if (amount === null || count === null) {
    if (typeof b.unavailableReason !== "string" || b.unavailableReason.trim() === "") {
      problems.push(`${here}: amountUsd or count is null so unavailableReason is required (non-empty string)`);
    }
    return;
  }
  // both non-null — source is required and well-formed
  const source = b.source;
  if (source === undefined || source === null || typeof source !== "object") {
    problems.push(`${here}: amountUsd=${amount} count=${count} but source is missing. Every non-null bucket requires source.`);
    return;
  }
  const s = source as Record<string, unknown>;
  if (typeof s.system !== "string" || s.system.trim() === "") {
    problems.push(`${here}: source.system must be a non-empty string`);
  }
  if (typeof s.retrievedAt !== "string" || s.retrievedAt.trim() === "") {
    problems.push(`${here}: source.retrievedAt must be a non-empty string (ISO 8601)`);
  }
}

function validateCashPosition(pos: unknown, problems: string[]): void {
  const here = "cashPosition";
  if (pos === null || typeof pos !== "object") {
    problems.push(`${here}: must be an object`);
    return;
  }
  const p = pos as Record<string, unknown>;
  const amount = p.amountUsd;
  if (amount === undefined) {
    problems.push(`${here}: amountUsd is required (number | null)`);
    return;
  }
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
    problems.push(`${here}: amountUsd must be a finite number or null`);
    return;
  }
  if (amount === null) {
    if (typeof p.unavailableReason !== "string" || p.unavailableReason.trim() === "") {
      problems.push(`${here}: amountUsd is null so unavailableReason is required (non-empty string)`);
    }
    return;
  }
  const source = p.source;
  if (source === undefined || source === null || typeof source !== "object") {
    problems.push(`${here}: amountUsd=${amount} but source is missing. Every non-null amount requires source.`);
    return;
  }
  const s = source as Record<string, unknown>;
  if (typeof s.system !== "string" || s.system.trim() === "") {
    problems.push(`${here}: source.system must be a non-empty string`);
  }
  if (typeof s.retrievedAt !== "string" || s.retrievedAt.trim() === "") {
    problems.push(`${here}: source.retrievedAt must be a non-empty string (ISO 8601)`);
  }
}

/**
 * Resolve the BoA checking 7020 cash position via Plaid. Returns
 * { amountUsd, source } on success, or { amountUsd: null,
 * unavailableReason } when Plaid is unconfigured / unconnected / erroring.
 * Never fabricates.
 */
async function resolvePlaidCashPosition(): Promise<{
  amountUsd: number | null;
  unavailableReason?: string;
  source?: { system: string; retrievedAt: string };
}> {
  if (!isPlaidConfigured()) {
    return {
      amountUsd: null,
      unavailableReason: "Plaid not configured (PLAID_CLIENT_ID / PLAID_SECRET unset).",
    };
  }
  try {
    if (!(await isPlaidConnected())) {
      return {
        amountUsd: null,
        unavailableReason: "Plaid configured but no access token stored. Ben needs to complete the Plaid Link flow.",
      };
    }
    const balances = await getBalances();
    if (!balances || balances.length === 0) {
      return {
        amountUsd: null,
        unavailableReason: "Plaid returned no accounts. Item may be disconnected or require re-auth.",
      };
    }
    // Primary per blueprint / CLAUDE.md: Bank of America checking 7020.
    // Match by name containing "checking" — fallback to the first
    // depository account if no explicit checking is found.
    const checking =
      balances.find((b) =>
        (b.name ?? "").toLowerCase().includes("checking") ||
        (b.officialName ?? "").toLowerCase().includes("checking"),
      ) ?? balances[0];
    const available = checking.balances.available ?? checking.balances.current;
    if (available == null) {
      return {
        amountUsd: null,
        unavailableReason: `Plaid account '${checking.name}' returned no available or current balance.`,
      };
    }
    return {
      amountUsd: available,
      source: {
        system: "plaid",
        retrievedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      amountUsd: null,
      unavailableReason: `Plaid getBalances failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
