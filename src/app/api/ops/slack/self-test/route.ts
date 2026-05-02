import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getChannel,
  listChannels,
  slackChannelRef,
} from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import type { ChannelId } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_EVENTS_URL = "https://www.usagummies.com/api/ops/slack/events";
const EXPECTED_INTERACTIVITY_URL = "https://www.usagummies.com/api/slack/approvals";

function envPresent(name: string): boolean {
  return Boolean((process.env[name] ?? "").trim());
}

function activeChannelRows() {
  return listChannels("active").map((c) => ({
    id: c.id,
    name: c.name,
    slackChannelId: c.slackChannelId ?? null,
    hasChannelId: Boolean(c.slackChannelId),
  }));
}

function resolveRequestedChannel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return slackChannelRef("ops-daily");
  const clean = raw.trim();
  const byId = getChannel(clean as ChannelId);
  if (byId?.state === "active" && byId.slackChannelId) return byId.slackChannelId;
  const bySlackId = listChannels("active").find((c) => c.slackChannelId === clean);
  if (bySlackId?.slackChannelId) return bySlackId.slackChannelId;
  return null;
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    env: {
      slackBotTokenPresent: envPresent("SLACK_BOT_TOKEN"),
      slackSigningSecretPresent: envPresent("SLACK_SIGNING_SECRET"),
    },
    urls: {
      events: EXPECTED_EVENTS_URL,
      interactivity: EXPECTED_INTERACTIVITY_URL,
    },
    activeChannels: activeChannelRows(),
    requiredScopes: [
      "chat:write",
      "channels:history or groups:history for read loops",
      "files:write for label/upload flows",
      "commands if slash commands are enabled",
    ],
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { channel?: unknown };
  const channel = resolveRequestedChannel(body.channel);
  if (!channel) {
    return NextResponse.json(
      { ok: false, code: "unknown_or_inactive_channel" },
      { status: 400 },
    );
  }
  const generatedAt = new Date().toISOString();
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "Slack self-test", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*Route*\n/api/ops/slack/self-test" },
        { type: "mrkdwn", text: `*Generated*\n${generatedAt}` },
        { type: "mrkdwn", text: "*Mutation*\nSlack test post only" },
        { type: "mrkdwn", text: "*Status*\nposting from repo bot" },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "No Gmail, HubSpot, QBO, Shopify, ShipStation, Faire, or approval state mutation happened.",
        },
      ],
    },
  ];
  const result = await postMessage({
    channel,
    text: "Slack self-test — repo bot post",
    blocks,
  });
  return NextResponse.json(
    {
      ok: result.ok,
      posted: result.ok,
      channel,
      ts: result.ts ?? null,
      error: result.ok ? null : result.error ?? "slack_post_failed",
      degraded: Boolean(result.degraded),
    },
    { status: result.ok ? 200 : 502 },
  );
}
