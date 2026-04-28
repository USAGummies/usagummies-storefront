/**
 * GET / POST /api/ops/wholesale/onboarding-digest — Phase 35.f.5.b
 *
 * Daily Slack digest of stalled wholesale onboarding flows. Calls
 * `listRecentFlows`, filters to stalled (heuristic same as the
 * /api/ops/wholesale/onboarding read surface), formats a #financials
 * post, and dispatches via the existing Slack client.
 *
 * **Auth:** CRON_SECRET bearer or session. Same posture as the read
 * surface; route prefix is in `SELF_AUTHENTICATED_PREFIXES`.
 *
 * **Idempotency:** dedup key
 *   `wholesale:onboarding-digest:dedup:<YYYY-MM-DD>` (24h TTL).
 *   Calling the route multiple times in a day is safe — only the
 *   first call posts. Pass `?force=true` to override the dedup
 *   gate (useful for ad-hoc replay; logs the override).
 *
 * **Empty-state:** if no flows are stalled, the route returns
 *   { ok: true, stalledCount: 0, posted: false } and writes NO
 *   Slack message. Rene doesn't need a "no news" ping.
 *
 * **Honest failure:** Slack failures surface as ok:false (the
 * route itself returns 200, but `posted: false` + the Slack error
 * is included so the caller can retry). This honors the operating-
 * memory rule: surface degraded state loudly, never silent.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import {
  nextStep,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";
import { listRecentFlows } from "@/lib/wholesale/onboarding-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Slack channel id for #financials (canonical per channels.json). */
const SLACK_FINANCIALS_CHANNEL_ID = "C0AKG9FSC2J";
const DEDUP_TTL_SECONDS = 24 * 3600;
const DEFAULT_STALL_HOURS = 24;

function dedupKey(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `wholesale:onboarding-digest:dedup:${yyyy}-${mm}-${dd}`;
}

interface StalledRow {
  flowId: string;
  currentStep: OnboardingStep;
  nextStep: OnboardingStep | null;
  prospect?: OnboardingState["prospect"];
  totalSubtotalUsd: number;
  hoursSinceLastTouch: number;
}

function mostRecentTimestamp(state: OnboardingState): string | undefined {
  const stamps = Object.values(state.timestamps).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (stamps.length === 0) return undefined;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

function isStalled(
  state: OnboardingState,
  stallMs: number,
  now: Date,
): { stalled: boolean; lastTimestamp: string | undefined } {
  const lastTimestamp = mostRecentTimestamp(state);
  const next = nextStep(state);
  const stalled =
    next !== null &&
    lastTimestamp !== undefined &&
    now.getTime() - new Date(lastTimestamp).getTime() > stallMs;
  return { stalled, lastTimestamp };
}

function buildSlackText(rows: readonly StalledRow[], stallHours: number): string {
  const lines: string[] = [];
  lines.push(
    `*Wholesale onboarding digest* — ${rows.length} flow${rows.length === 1 ? "" : "s"} stalled (no progress in ${stallHours}h+)`,
  );
  lines.push("");
  for (const r of rows) {
    const company = r.prospect?.companyName ?? "(unknown)";
    const email = r.prospect?.contactEmail ?? "(no email)";
    const subtotal =
      r.totalSubtotalUsd > 0 ? `$${r.totalSubtotalUsd.toFixed(2)}` : "(no order yet)";
    lines.push(
      `• *${company}* (${email}) — stalled at \`${r.currentStep}\`, next: \`${r.nextStep ?? "—"}\` — ${subtotal} — ${r.hoursSinceLastTouch.toFixed(0)}h since last touch — flow \`${r.flowId}\``,
    );
  }
  lines.push("");
  lines.push(
    `_Run \`curl -H "Authorization: Bearer $CRON_SECRET" https://www.usagummies.com/api/ops/wholesale/onboarding?stalledOnly=true\` for full detail._`,
  );
  return lines.join("\n");
}

async function buildDigest(stallHours: number, now: Date): Promise<{
  rows: StalledRow[];
}> {
  const stallMs = stallHours * 3_600_000;
  const flows = await listRecentFlows({ limit: 500 });
  const rows: StalledRow[] = [];
  for (const f of flows) {
    const { stalled, lastTimestamp } = isStalled(f, stallMs, now);
    if (!stalled || !lastTimestamp) continue;
    rows.push({
      flowId: f.flowId,
      currentStep: f.currentStep,
      nextStep: nextStep(f),
      prospect: f.prospect,
      totalSubtotalUsd:
        Math.round(
          f.orderLines.reduce((acc, l) => acc + l.subtotalUsd, 0) * 100,
        ) / 100,
      hoursSinceLastTouch:
        (now.getTime() - new Date(lastTimestamp).getTime()) / 3_600_000,
    });
  }
  return { rows };
}

async function handle(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawStall = Number.parseInt(
    url.searchParams.get("stallHours") ?? String(DEFAULT_STALL_HOURS),
    10,
  );
  const stallHours = Number.isFinite(rawStall)
    ? Math.max(1, Math.min(720, rawStall))
    : DEFAULT_STALL_HOURS;
  const force = url.searchParams.get("force") === "true";

  const now = new Date();

  // Dedup gate (unless force).
  const dKey = dedupKey(now);
  if (!force) {
    const existing = await kv.get(dKey).catch(() => null);
    if (existing) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already-posted-today",
      });
    }
  }

  let rows;
  try {
    ({ rows } = await buildDigest(stallHours, now));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "kv_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  if (rows.length === 0) {
    // Don't post empty digests — Rene doesn't need "no news" pings.
    return NextResponse.json({
      ok: true,
      stalledCount: 0,
      posted: false,
    });
  }

  const text = buildSlackText(rows, stallHours);
  const slack = await postMessage({
    channel: SLACK_FINANCIALS_CHANNEL_ID,
    text,
  });

  if (!slack.ok) {
    // Don't write the dedup marker — let the next cron retry.
    return NextResponse.json({
      ok: false,
      stalledCount: rows.length,
      posted: false,
      slackError: slack.error,
    });
  }

  // Write dedup marker.
  await kv
    .set(dKey, JSON.stringify({ ts: slack.ts, stalledCount: rows.length }), {
      ex: DEDUP_TTL_SECONDS,
    })
    .catch(() => {
      // Dedup miss is acceptable — at most we double-post tomorrow's
      // first run.
    });

  return NextResponse.json({
    ok: true,
    stalledCount: rows.length,
    posted: true,
    slackTs: slack.ts,
  });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
