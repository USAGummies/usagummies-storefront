/**
 * GET /api/content-factory/list?status=approved|rejected|pending&profile=<style>
 *
 * Lists images in the content-factory registry, optionally filtered by
 * status and style profile. Used by the launcher (add-round*-ads.mjs) to
 * pull approved images for a new campaign without regenerating.
 *
 * Auth: requires CRON_SECRET bearer (same as other ops endpoints).
 */

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "approved").toLowerCase();
  const profile = url.searchParams.get("profile");

  if (!["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const indexKey = status === "pending" ? null : `content-factory:index:${status}`;
  const ids = indexKey ? ((await kv.get<string[]>(indexKey)) || []) : [];

  const entries: unknown[] = [];
  for (const id of ids) {
    const entry =
      status === "pending"
        ? await kv.get(`content-factory:pending:${id}`)
        : await kv.get(`content-factory:registry:${status}:${id}`);
    if (!entry) continue;
    if (profile && (entry as { profile?: string }).profile !== profile) continue;
    entries.push(entry);
  }

  return NextResponse.json({
    status,
    profile: profile || "all",
    count: entries.length,
    entries,
  });
}
