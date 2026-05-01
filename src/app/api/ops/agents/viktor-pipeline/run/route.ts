/**
 * Viktor Pipeline Digest — weekly Monday morning #sales post.
 *
 * Bounded Viktor role per /contracts/viktor.md: HubSpot maintenance +
 * Slack Q&A. This runtime extends that with a weekly digest so Ben
 * has one-page visibility into B2B pipeline health without opening
 * HubSpot.
 *
 * Signals rendered (via src/lib/ops/viktor-pipeline.ts):
 *   - Deal count + total $ by stage (Lead / PO Received / Shipped / Closed Won)
 *   - Stale deals (no HubSpot activity >14 days)
 *   - Deals expected to close this month (closedate within 30d)
 *   - Top 5 active deals by amount
 *
 * Degraded-mode contract: when `HUBSPOT_PRIVATE_APP_TOKEN` missing,
 * the digest renders "unavailable" + returns early without fabricating.
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  isHubSpotConfigured,
  listRecentDeals,
} from "@/lib/ops/hubspot-client";
import {
  renderPipelineDigest,
  summarizePipeline,
} from "@/lib/ops/viktor-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}
export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}

async function runAgent(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";

  if (!isHubSpotConfigured()) {
    const rendered =
      ":bust_in_silhouette: *Viktor pipeline digest — DEGRADED*\n" +
      "`HUBSPOT_PRIVATE_APP_TOKEN` not configured. Wire it on Vercel to unblock weekly pipeline visibility.";
    if (shouldPost) await tryPost(rendered);
    return NextResponse.json({ ok: true, degraded: ["hubspot_not_configured"], rendered });
  }

  const deals = await listRecentDeals({ limit: 500 });
  const digest = summarizePipeline(deals);
  const rendered = renderPipelineDigest(digest);

  let posted = false;
  if (shouldPost) {
    posted = await tryPost(rendered);
  }

  return NextResponse.json({
    ok: true,
    posted,
    totalDeals: digest.totalDeals,
    totalOpenDollars: Math.round(digest.totalOpenDollars * 100) / 100,
    rollup: digest.rollup,
    closingSoonCount: digest.closingSoon.length,
    staleCount: digest.staleDeals.length,
    rendered,
  });
}

async function tryPost(text: string): Promise<boolean> {
  const channel = getChannel("sales") ?? getChannel("ops-daily");
  if (!channel) return false;
  try {
    const channelId = channel.id === "sales" ? "sales" : "ops-daily";
    const res = await postMessage({ channel: slackChannelRef(channelId), text });
    return res.ok;
  } catch {
    return false;
  }
}
