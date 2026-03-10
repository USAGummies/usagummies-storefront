import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getUnresolvedDeadLetters } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedHealthRow = {
  feed_key: string;
  is_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  consecutive_failures: number | null;
  schedule_cron: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const feedRows = (await sbFetch(
      "/rest/v1/abra_auto_teach_feeds?select=feed_key,is_active,last_run_at,last_status,consecutive_failures,schedule_cron&order=feed_key.asc",
    )) as FeedHealthRow[];
    const deadLetters = await getUnresolvedDeadLetters();

    const feeds = Array.isArray(feedRows)
      ? feedRows.map((row) => ({
          feed_key: row.feed_key,
          is_active: !!row.is_active,
          last_run_at: row.last_run_at,
          last_status: row.last_status,
          consecutive_failures: Number(row.consecutive_failures || 0),
          schedule_cron: row.schedule_cron || "",
        }))
      : [];

    return NextResponse.json({
      feeds,
      dead_letters: deadLetters.map((item) => ({
        id: item.id,
        feed_key: item.feed_key,
        error_message: item.error_message || "",
        created_at: item.created_at,
        retry_count: item.retry_count,
      })),
      summary: {
        total_feeds: feeds.length,
        active: feeds.filter((feed) => feed.is_active).length,
        disabled: feeds.filter((feed) => !feed.is_active).length,
        unresolved_dead_letters: deadLetters.length,
      },
    });
  } catch (error) {
    console.error("[feed-health] failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read feed health",
      },
      { status: 500 },
    );
  }
}
