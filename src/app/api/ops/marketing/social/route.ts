import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import {
  isTwitterConfigured,
  getMentions,
  getRecentTweets,
  replyToTweet,
} from "@/lib/social/twitter";
import {
  isTruthSocialConfigured,
  getNotifications,
  getTimeline,
  replyToStatus,
} from "@/lib/social/truthsocial";
import { crossPost } from "@/lib/social/cross-poster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000;

type SocialResponse = {
  platforms: {
    x: {
      configured: boolean;
      followers: number | null;
      recentPosts: Array<{
        id: string;
        text: string;
        createdAt: string | null;
        likes: number;
        replies: number;
        reposts: number;
        impressions: number;
      }>;
      unrespondedMentions: Array<{
        id: string;
        text: string;
        authorId: string;
        createdAt: string | null;
      }>;
    };
    truth: {
      configured: boolean;
      followers: number | null;
      recentPosts: Array<{
        id: string;
        text: string;
        createdAt: string | null;
        likes: number;
        replies: number;
        reposts: number;
      }>;
      unrespondedMentions: Array<{
        id: string;
        text: string;
        account: string;
        createdAt: string | null;
      }>;
    };
  };
  autoResponder: {
    enabled: boolean;
    responseCountToday: number;
  };
  generatedAt: string;
  error?: string;
};

function emptySocial(): SocialResponse {
  return {
    platforms: {
      x: { configured: false, followers: null, recentPosts: [], unrespondedMentions: [] },
      truth: { configured: false, followers: null, recentPosts: [], unrespondedMentions: [] },
    },
    autoResponder: {
      enabled: (process.env.SOCIAL_AUTORESPONDER_ENABLED || "false").toLowerCase() === "true",
      responseCountToday: 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const cached = await readState<CacheEnvelope<SocialResponse> | null>("social-cache", null);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  const output = emptySocial();

  try {
    if (isTwitterConfigured()) {
      output.platforms.x.configured = true;
      const [posts, mentions] = await Promise.all([getRecentTweets(20), getMentions()]);

      output.platforms.x.recentPosts = (posts.data || []).map((post) => ({
        id: post.id,
        text: post.text,
        createdAt: post.created_at || null,
        likes: post.public_metrics?.like_count || 0,
        replies: post.public_metrics?.reply_count || 0,
        reposts: post.public_metrics?.retweet_count || 0,
        impressions: post.public_metrics?.impression_count || 0,
      }));

      output.platforms.x.unrespondedMentions = (mentions.data || []).map((mention) => ({
        id: mention.id,
        text: mention.text,
        authorId: mention.author_id || "",
        createdAt: mention.created_at || null,
      }));
    }
  } catch (err) {
    output.error = "Internal server error";
  }

  try {
    if (isTruthSocialConfigured()) {
      output.platforms.truth.configured = true;
      const [timeline, notifications] = await Promise.all([getTimeline(20), getNotifications()]);

      output.platforms.truth.recentPosts = timeline.map((entry) => ({
        id: String(entry.id || ""),
        text: String(entry.content || ""),
        createdAt: String(entry.created_at || "") || null,
        likes: Number(entry.favourites_count || 0),
        replies: Number(entry.replies_count || 0),
        reposts: Number(entry.reblogs_count || 0),
      }));

      output.platforms.truth.unrespondedMentions = notifications
        .filter((item) => String(item.type || "") === "mention")
        .map((item) => {
          const status = (item.status as Record<string, unknown>) || {};
          const account = (status.account as Record<string, unknown>) || {};
          return {
            id: String(status.id || item.id || ""),
            text: String(status.content || ""),
            account: String(account.acct || account.username || ""),
            createdAt: String(status.created_at || "") || null,
          };
        });
    }
  } catch (err) {
    output.error = output.error || ("Internal server error");
  }

  const actionLog = await readState<Array<{ action: string; at: string }>>("social-action-log", []);
  output.autoResponder.responseCountToday = (Array.isArray(actionLog) ? actionLog : []).filter(
    (entry) => entry.action === "auto-response" && (entry.at || "").startsWith(todayKey()),
  ).length;

  output.generatedAt = new Date().toISOString();

  await writeState("social-cache", {
    data: output,
    cachedAt: Date.now(),
  });

  return NextResponse.json(output);
}

type SocialPostBody = {
  action?: "post" | "auto-respond";
  text?: string;
  platforms?: Array<"x" | "truth">;
  platform?: "x" | "truth";
  targetId?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SocialPostBody;

    if (body.action === "auto-respond") {
      if (!body.platform || !body.targetId || !body.text) {
        return NextResponse.json({ error: "platform, targetId, and text are required" }, { status: 400 });
      }

      if (body.platform === "x") {
        await replyToTweet(body.targetId, body.text);
      } else {
        await replyToStatus(body.targetId, body.text);
      }

      const existing = await readState<Array<{ action: string; at: string }>>("social-action-log", []);
      await writeState("social-action-log", [
        ...(Array.isArray(existing) ? existing : []),
        { action: "auto-response", at: new Date().toISOString() },
      ]);

      return NextResponse.json({ ok: true, action: "auto-respond" });
    }

    const text = (body.text || "").trim();
    const platforms = body.platforms || [];
    if (!text || platforms.length === 0) {
      return NextResponse.json({ error: "text and platforms are required" }, { status: 400 });
    }

    const result = await crossPost({ text, platforms });
    const existing = await readState<Array<{ action: string; at: string }>>("social-action-log", []);
    await writeState("social-action-log", [
      ...(Array.isArray(existing) ? existing : []),
      { action: "post", at: new Date().toISOString() },
    ]);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
