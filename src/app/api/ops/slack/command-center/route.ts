/**
 * POST /api/ops/slack/command-center
 *
 * Slack-postable operator dashboard. This is a read-model fan-out:
 * it reads the Sales Command sources, renders a compact Block Kit
 * card, and optionally posts it to #ops-daily. It does not mutate
 * Gmail, HubSpot, QBO, Shopify, Faire, ShipStation, or approval state.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { readAllChannelsLast7d } from "@/lib/ops/revenue-kpi-readers";
import { buildSalesCommandCenter } from "@/lib/ops/sales-command-center";
import {
  readAllAgingItems,
  readApPackets,
  readDay1Prospects,
  readFaireFollowUps,
  readFaireInvites,
  readLocationDrafts,
  readPendingApprovals,
  readSalesPipeline,
  readSalesTourPlaybook,
  readStaleBuyers,
  readWholesaleInquiries,
} from "@/lib/ops/sales-command-readers";
import { renderSalesCommandCenterSlack } from "@/lib/ops/slack-command-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildReport(now: Date) {
  const [
    faireInvites,
    faireFollowUps,
    pendingApprovals,
    apPackets,
    locationDrafts,
    aging,
    revenueChannels,
    wholesaleInquiries,
    day1Prospects,
    salesTour,
    salesPipeline,
    staleBuyers,
  ] = await Promise.all([
    readFaireInvites(),
    readFaireFollowUps(now),
    readPendingApprovals(),
    readApPackets(),
    readLocationDrafts(),
    readAllAgingItems(now),
    readAllChannelsLast7d(now),
    readWholesaleInquiries(),
    readDay1Prospects(),
    readSalesTourPlaybook(),
    readSalesPipeline(now),
    readStaleBuyers(now),
  ]);

  return buildSalesCommandCenter(
    {
      faireInvites,
      faireFollowUps,
      pendingApprovals,
      apPackets,
      locationDrafts,
      agingItems: aging.items,
      agingMissing: aging.missing,
      revenueChannels,
      wholesaleInquiries,
      day1Prospects,
      salesTour,
      salesPipeline,
      staleBuyers,
      dispatchNotWiredReason:
        "Dispatch summary is owned by /api/ops/sales; Slack card uses the compact sales read model.",
    },
    { now },
  );
}

function defaultChannel(): string {
  const channel = getChannel("ops-daily");
  return channel?.slackChannelId ?? channel?.name ?? "#ops-daily";
}

async function handle(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";
  const now = new Date();
  const report = await buildReport(now);
  const message = renderSalesCommandCenterSlack(report);

  if (!shouldPost) {
    return NextResponse.json({ ok: true, posted: false, message });
  }

  const body = await req.json().catch(() => ({})) as { channel?: string };
  const channel = typeof body.channel === "string" && body.channel.trim()
    ? body.channel.trim()
    : defaultChannel();
  const result = await postMessage({
    channel,
    text: message.text,
    blocks: message.blocks,
  });

  return NextResponse.json({
    ok: result.ok,
    posted: result.ok,
    channel,
    ts: result.ts ?? null,
    error: result.ok ? null : result.error ?? "slack_post_failed",
    degraded: Boolean(result.degraded),
    message,
  }, { status: result.ok ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
