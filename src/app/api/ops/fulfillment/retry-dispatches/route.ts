/**
 * GET/POST /api/ops/fulfillment/retry-dispatches
 *
 * Drain the dispatch-retry-queue. When a webhook (Shopify or HubSpot)
 * classified an OrderIntent but Slack refused the post, the intent
 * lives in KV `fulfillment:dispatch-retry-queue`. This route walks
 * the queue and reposts.
 *
 * Cron: every 30 min during business hours. Alerts `#ops-alerts`
 * when any entry crosses MAX_ATTEMPTS (exhausted).
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  drainRetryQueue,
  exhaustedRetryCount,
  pendingRetryCount,
  readRetryQueue,
} from "@/lib/ops/dispatch-retry-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return run(req);
}
export async function POST(req: Request): Promise<Response> {
  return run(req);
}

async function run(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldAlert = url.searchParams.get("alert") !== "false";

  const approvals = getChannel("ops-approvals");
  if (!approvals) {
    return NextResponse.json(
      { ok: false, error: "#ops-approvals channel not registered" },
      { status: 502 },
    );
  }

  const results = await drainRetryQueue(async (entry) => {
    try {
      const res = await postMessage({
        channel: approvals.name,
        text: entry.proposal.renderedMarkdown,
      });
      return {
        ok: res.ok,
        ts: res.ts,
        channel: approvals.name,
        error: res.error,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const attempted = results.filter((r) => r.attempted).length;
  const posted = results.filter((r) => r.posted).length;
  const stillPending = await pendingRetryCount();
  const exhausted = await exhaustedRetryCount();

  // When anything exhausted, escalate to #ops-alerts (Ben needs to
  // manually review/retry those — likely a persistent Slack or channel
  // registration issue).
  if (shouldAlert && exhausted > 0) {
    const alerts = getChannel("ops-alerts");
    if (alerts) {
      const queue = await readRetryQueue();
      const exhaustedList = queue
        .filter((e) => e.status === "exhausted")
        .slice(0, 10);
      const lines = [
        `:rotating_light: *Dispatch retry queue — ${exhausted} exhausted*`,
        `_These intents failed to post to #ops-approvals after 5 attempts. Manual review needed._`,
        "",
        ...exhaustedList.map(
          (e) =>
            `  • \`${e.intent.channel}:${e.intent.sourceId}\` — ${e.proposal.summary} · last error: \`${e.lastError ?? "?"}\``,
        ),
      ];
      try {
        await postMessage({ channel: alerts.name, text: lines.join("\n") });
      } catch {
        /* best-effort */
      }
    }
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    attempted,
    posted,
    stillPending,
    exhausted,
    results: results.map((r) => ({
      channel: r.entry.intent.channel,
      sourceId: r.entry.intent.sourceId,
      status: r.entry.status,
      attempts: r.entry.attempts,
      attempted: r.attempted,
      posted: r.posted,
      error: r.error ?? r.entry.lastError,
    })),
  });
}
