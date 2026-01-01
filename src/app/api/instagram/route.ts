import { NextResponse } from "next/server";
import { fetchInstagramFeed } from "@/lib/instagram";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || "12");

  const feed = await fetchInstagramFeed({ limit });

  // Strong caching for stability; refreshes periodically.
  // If env vars are missing or the API fails, we return an empty feed (fallback) rather than breaking the page.
  return NextResponse.json(feed, {
    headers: {
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
    },
  });
}
