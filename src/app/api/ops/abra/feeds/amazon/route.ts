import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runFeed, type FeedResult } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isConfigError(message?: string): boolean {
  return /not configured|missing .*creds?|credentials/i.test(message || "");
}

function toStatus(results: FeedResult[]): number {
  if (results.every((result) => result.success)) return 200;
  const errors = results
    .filter((result) => !result.success)
    .map((result) => result.error || "");
  if (errors.length > 0 && errors.every((error) => isConfigError(error))) {
    return 424;
  }
  return 502;
}

async function runAmazonFeeds(): Promise<FeedResult[]> {
  const orders = await runFeed("amazon_orders");
  const inventory = await runFeed("amazon_inventory");
  return [orders, inventory];
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
}

export async function GET(req: Request) {
  return POST(req);
}
