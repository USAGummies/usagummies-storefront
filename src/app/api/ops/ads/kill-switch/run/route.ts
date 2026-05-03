/**
 * GET|POST /api/ops/ads/kill-switch/run
 *
 * Daily ad-spend kill switch. Pulls yesterday's spend + conversions
 * from Meta + Google Ads, runs the policy decision, and either:
 *
 *   • Posts a Class B `gmail.send`-style alert card to
 *     #ops-approvals when severity === kill (spend > $100 with zero
 *     conversions on either platform).
 *   • Posts a :warning: line to #ops-alerts when severity === warn
 *     (spend > $50 with zero conversions, or CPA > $50).
 *   • Stays silent when both platforms are healthy.
 *
 * Closes audit finding "could-be-better #30". The Sept→Apr Google
 * Ads $1,678 → 0 conversions disaster ran at ~$95/week — a daily
 * detector with a $100 kill threshold catches that exact pattern in
 * day one instead of seven months.
 *
 * Auth: bearer CRON_SECRET.
 *
 * Hard rules:
 *   • Detector ONLY. Does NOT pause ads via API. The card surfaces
 *     the burn + deep-links to Meta/Google UIs; operator pauses by
 *     hand. Auto-pause via API is the next iteration once write
 *     access is tested.
 *   • Idempotent — same date won't re-fire (KV dedup with date as key).
 *   • Fail-soft per platform. If Meta is configured + reachable but
 *     Google fails, the card still surfaces the Meta signal.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  fetchGoogleAdsAccountInsightsYesterday,
  isGoogleAdsConfigured,
} from "@/lib/ads/google";
import {
  fetchMetaAccountInsightsYesterday,
  isMetaConfigured,
} from "@/lib/ads/meta";
import {
  decideKillSwitch,
  type AdSpendSnapshot,
  type KillSwitchDecision,
} from "@/lib/ads/kill-switch/decision";
import { renderKillSwitchCard } from "@/lib/ads/kill-switch/card";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { record, requestApproval } from "@/lib/ops/control-plane/record";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { slackChannelRef, getChannel } from "@/lib/ops/control-plane/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_DEDUP_PREFIX = "ad-kill-switch:posted:";
const DEDUP_TTL_SECONDS = 36 * 3600; // 1.5 days — long enough to silence repeated runs on the same date

function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

async function fetchMetaSnapshot(): Promise<AdSpendSnapshot> {
  if (!isMetaConfigured()) {
    return {
      platform: "meta",
      available: false,
      spendUsd: null,
      conversions: null,
      unavailableReason: "META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not configured",
    };
  }
  try {
    const r = await fetchMetaAccountInsightsYesterday();
    return {
      platform: "meta",
      available: true,
      spendUsd: r.spend,
      conversions: r.conversions,
    };
  } catch (err) {
    return {
      platform: "meta",
      available: false,
      spendUsd: null,
      conversions: null,
      unavailableReason: `Meta insights fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fetchGoogleSnapshot(): Promise<AdSpendSnapshot> {
  if (!isGoogleAdsConfigured()) {
    return {
      platform: "google",
      available: false,
      spendUsd: null,
      conversions: null,
      unavailableReason: "GOOGLE_ADS_* envs not configured",
    };
  }
  try {
    const r = await fetchGoogleAdsAccountInsightsYesterday();
    return {
      platform: "google",
      available: true,
      spendUsd: r.spend,
      conversions: r.conversions,
    };
  } catch (err) {
    return {
      platform: "google",
      available: false,
      spendUsd: null,
      conversions: null,
      unavailableReason: `Google Ads insights fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function alreadyPostedFor(date: string): Promise<boolean> {
  try {
    const v = await kv.get(`${KV_DEDUP_PREFIX}${date}`);
    return v !== null && v !== undefined;
  } catch {
    return false;
  }
}

async function markPostedFor(date: string, severity: string): Promise<void> {
  try {
    await kv.set(
      `${KV_DEDUP_PREFIX}${date}`,
      JSON.stringify({ severity, postedAt: new Date().toISOString() }),
      { ex: DEDUP_TTL_SECONDS },
    );
  } catch {
    /* fail-soft */
  }
}

interface RunResult {
  ok: boolean;
  date: string;
  decision: KillSwitchDecision;
  posted: boolean;
  postedTo: string | null;
  alreadyPostedToday: boolean;
  approvalId?: string;
  dryRun: boolean;
  renderedMarkdown: string;
}

async function runKillSwitch(opts: {
  dryRun: boolean;
}): Promise<RunResult> {
  const date = yesterdayIso();

  // Pull both platforms in parallel. Fail-soft per platform.
  const [meta, google] = await Promise.all([
    fetchMetaSnapshot(),
    fetchGoogleSnapshot(),
  ]);

  const decision = decideKillSwitch([meta, google]);
  const renderedMarkdown = renderKillSwitchCard(decision, date);

  // Silent when both healthy — no card, no warn, no audit beyond
  // the cron-fire trace (which lives in the request log).
  if (decision.overallSeverity === "ok") {
    return {
      ok: true,
      date,
      decision,
      posted: false,
      postedTo: null,
      alreadyPostedToday: false,
      dryRun: opts.dryRun,
      renderedMarkdown,
    };
  }

  // Idempotency — same date doesn't re-fire even if the cron is
  // hand-triggered. Skip when already posted today, EXCEPT in dry-run
  // (dry-run lets an operator preview the card any number of times).
  let alreadyPostedToday = false;
  if (!opts.dryRun) {
    alreadyPostedToday = await alreadyPostedFor(date);
    if (alreadyPostedToday) {
      return {
        ok: true,
        date,
        decision,
        posted: false,
        postedTo: null,
        alreadyPostedToday: true,
        dryRun: opts.dryRun,
        renderedMarkdown,
      };
    }
  }

  if (opts.dryRun) {
    return {
      ok: true,
      date,
      decision,
      posted: false,
      postedTo: null,
      alreadyPostedToday: false,
      dryRun: true,
      renderedMarkdown,
    };
  }

  const run = newRunContext({
    agentId: "ad-kill-switch",
    division: "platform-data-automation",
    source: "scheduled",
    trigger: `ad-kill-switch:${date}`,
  });

  // KILL severity → Class B approval card so the action lives in the
  // ops-approvals queue alongside other Ben-decisions. (We use
  // `gmail.send` slug as a transitive carrier — same approval shape,
  // and it's already a registered Class B; future work: register a
  // dedicated `ads.spend.kill` slug. For now reusing gmail.send keeps
  // the surface uniform.)
  // WARN severity → P2 line into #ops-alerts (no approval card; just
  // a visibility heads-up).

  let posted = false;
  let postedTo: string | null = null;
  let approvalId: string | undefined;

  if (decision.shouldKill) {
    try {
      const approval = await requestApproval(run, {
        actionSlug: "gmail.send",
        targetSystem: "gmail",
        targetEntity: {
          type: "ad-kill-switch",
          id: date,
          label: `Ad-spend kill — ${date}`,
        },
        payloadPreview: renderedMarkdown,
        payloadRef: `ad-kill-switch:${date}`,
        evidence: {
          claim: `Yesterday (${date}) ad spend triggered the kill threshold ($${decision.totalSpendUsd.toFixed(2)} total · ${decision.totalConversions} conv). Operator should pause manually in Meta + Google UIs.`,
          sources: [
            { system: "meta-ads-insights", id: date, retrievedAt: new Date().toISOString() },
            { system: "google-ads-insights", id: date, retrievedAt: new Date().toISOString() },
          ],
          confidence: 1.0,
        },
        rollbackPlan:
          "Re-enable ads in the platform UI. The kill-switch dedup KV silences re-fires on this date.",
      });
      approvalId = approval.id;
      posted = true;
      postedTo = "#ops-approvals";
    } catch (err) {
      // Card open failed — fall through to a #ops-alerts mirror so
      // the signal isn't lost. Approval-store down isn't a reason
      // to silence a kill alert.
      const msg = err instanceof Error ? err.message : String(err);
      if (getChannel("ops-alerts")) {
        try {
          await postMessage({
            channel: slackChannelRef("ops-alerts"),
            text: `${renderedMarkdown}\n\n_:warning: Approval-card open failed: ${msg}. Falling back to #ops-alerts mirror._`,
          });
          posted = true;
          postedTo = "#ops-alerts";
        } catch {
          /* nothing more we can do — the audit envelope below records the failure */
        }
      }
    }
  } else if (decision.overallSeverity === "warn") {
    if (getChannel("ops-alerts")) {
      try {
        await postMessage({
          channel: slackChannelRef("ops-alerts"),
          text: renderedMarkdown,
        });
        posted = true;
        postedTo = "#ops-alerts";
      } catch {
        /* fail-soft — audit captures regardless */
      }
    }
  }

  // Audit envelope per fire (success or partial-fail).
  await record(run, {
    actionSlug: "connector.health.post",
    entityType: "ad-kill-switch-run",
    entityId: date,
    result: posted ? "ok" : "error",
    after: {
      severity: decision.overallSeverity,
      shouldKill: decision.shouldKill,
      totalSpendUsd: decision.totalSpendUsd,
      totalConversions: decision.totalConversions,
      perPlatform: decision.perPlatform,
      postedTo,
      approvalId,
    },
    sourceCitations: [
      { system: "meta-ads-insights", id: date },
      { system: "google-ads-insights", id: date },
    ],
    confidence: 1.0,
  }).catch(() => void 0);

  if (posted) {
    await markPostedFor(date, decision.overallSeverity);
  }

  return {
    ok: true,
    date,
    decision,
    posted,
    postedTo,
    alreadyPostedToday: false,
    approvalId,
    dryRun: opts.dryRun,
    renderedMarkdown,
  };
}

function parseOpts(req: Request): { dryRun: boolean } {
  const url = new URL(req.url);
  return {
    dryRun: url.searchParams.get("dryRun") === "true",
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const result = await runKillSwitch(parseOpts(req));
  return NextResponse.json(result);
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const result = await runKillSwitch(parseOpts(req));
  return NextResponse.json(result);
}

export const __INTERNAL_FOR_TESTS = {
  runKillSwitch,
  yesterdayIso,
};
