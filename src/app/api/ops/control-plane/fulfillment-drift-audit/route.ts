/**
 * GET /api/ops/control-plane/fulfillment-drift-audit
 *
 * Weekly fulfillment drift-audit scorecard. Checks policy compliance
 * for the 9-BUILD + ATP + delivered-pricing stack layered on
 * 2026-04-20. Posts to `#ops-audit` only when findings exist.
 *
 * Runs alongside the existing Sunday 20:00 PT drift audit. Separate
 * cron entry so failures here don't degrade the control-plane audit.
 *
 * Query params:
 *   - windowDays: 1-30, default 14
 *   - post=true|false: default true
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  renderFulfillmentDriftMarkdown,
  runFulfillmentDriftAudit,
} from "@/lib/ops/fulfillment-drift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(s: string | null, fallback: number, min: number, max: number): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 14, 1, 30);
  const shouldPost = url.searchParams.get("post") !== "false";

  const scorecard = await runFulfillmentDriftAudit({ windowDays });
  const rendered = renderFulfillmentDriftMarkdown(scorecard);

  let posted = false;
  let postedTo: string | null = null;
  const degraded: string[] = [...scorecard.degraded];

  // Post when there's findings OR meaningful weekly activity. The
  // render helper returns "" when neither is true so we can just
  // check for non-empty rendered output.
  if (shouldPost && rendered.length > 0) {
    const channel = getChannel("ops-audit");
    if (!channel) {
      degraded.push("slack-post: #ops-audit channel not registered");
    } else {
      try {
        const res = await postMessage({ channel: channel.name, text: rendered });
        if (res.ok) {
          posted = true;
          postedTo = channel.name;
        } else {
          degraded.push("slack-post: not ok");
        }
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    posted,
    postedTo,
    scorecard,
    rendered,
    degraded,
  });
}
