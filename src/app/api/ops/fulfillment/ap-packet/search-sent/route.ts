/**
 * GET /api/ops/fulfillment/ap-packet/search-sent?query=...&limit=10
 *
 * Diagnostic search over Gmail via the server's OAuth token. Used to
 * widen dedup beyond the exact `to:<apEmail>` match when the packet's
 * reply was sent to a different address (e.g. an individual buyer
 * instead of the generic AP inbox), or when the exact subject is
 * slightly different.
 *
 * Pure read-only — no sends, no KV writes, no mutations. Safe to
 * iterate on different queries.
 *
 * Auth: session OR bearer CRON_SECRET (under /api/ops/fulfillment —
 * already whitelisted in middleware).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listEmails } from "@/lib/ops/gmail-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json(
      {
        error:
          "query required. Pass a Gmail search string, e.g. ?query=to:@junglejims.com after:2026/04/20",
      },
      { status: 400 },
    );
  }
  const limit = Math.max(
    1,
    Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );
  try {
    const envelopes = await listEmails({ query, count: limit });
    return NextResponse.json({
      ok: true,
      query,
      limit,
      count: envelopes.length,
      messages: envelopes.map((e) => ({
        id: e.id,
        threadId: e.threadId,
        from: e.from,
        to: e.to,
        subject: e.subject,
        date: e.date,
        snippet: e.snippet,
        labelIds: e.labelIds,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Gmail search failed: ${err instanceof Error ? err.message : String(err)}`,
        query,
      },
      { status: 502 },
    );
  }
}
