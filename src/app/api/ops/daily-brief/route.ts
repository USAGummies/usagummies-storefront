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
  type BriefKind,
  type RevenueLine,
} from "@/lib/ops/control-plane/daily-brief";
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
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: BriefKind = kindParam === "eod" ? "eod" : "morning";
  const postToSlack = url.searchParams.get("post") !== "false";

  // Optional JSON body with caller-supplied revenue / cash overrides.
  let overrides: BriefBodyOverrides = {};
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      const raw = await req.text();
      if (raw.trim().length > 0) {
        overrides = JSON.parse(raw) as BriefBodyOverrides;
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

  const lastDriftAuditSummary = findLastDriftAuditSummary(recentAudit);

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

function findLastDriftAuditSummary(entries: readonly { action: string; after?: unknown }[]): string | undefined {
  // auditStore.recent returns newest-first.
  const hit = entries.find((e) => e.action === "drift-audit.scorecard");
  if (!hit) return undefined;
  return typeof hit.after === "string" ? hit.after : undefined;
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
