import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runFeed, type FeedResult } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const FEED_TIMEOUT_MS = 12000;

function toStatus(results: FeedResult[]): number {
  if (results.every((result) => result.success)) return 200;
  return 424;
}

function runFeedWithTimeout(feedKey: string): Promise<FeedResult> {
  return Promise.race<FeedResult>([
    runFeed(feedKey),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          feed_key: feedKey,
          success: false,
          entriesCreated: 0,
          error: `Timed out after ${Math.round(FEED_TIMEOUT_MS / 1000)}s`,
        });
      }, FEED_TIMEOUT_MS);
    }),
  ]);
}

async function runAmazonFeeds(): Promise<FeedResult[]> {
  const [orders, inventory] = await Promise.all([
    runFeedWithTimeout("amazon_orders"),
    runFeedWithTimeout("amazon_inventory"),
  ]);
  return [orders, inventory];
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAmazonFeeds();
    const entriesCreated = results.reduce(
      (sum, result) => sum + Number(result.entriesCreated || 0),
      0,
    );

    return NextResponse.json(
      {
        feed: "amazon",
        status: results.every((result) => result.success) ? "ok" : "error",
        entriesCreated,
        results,
      },
      { status: toStatus(results) },
    );
  } catch (error) {
    return NextResponse.json(
      {
        feed: "amazon",
        status: "error",
        entriesCreated: 0,
        error: error instanceof Error ? error.message : "Amazon feed failed",
      },
      { status: 424 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
