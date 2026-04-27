/**
 * GET /api/ops/customers/amazon
 *
 * Phase 28k — read-only Amazon FBM customer registry. Backs the
 * `/ops/customers/amazon` dashboard. Returns the list of unique
 * buyers we've shipped to, sorted by most-recent first by default.
 *
 * Query params:
 *   - limit:       default 100, max 500
 *   - sortBy:      "lastSeen" | "firstSeen" | "orderCount" | "totalRevenue"
 *                  (default "lastSeen")
 *   - repeatOnly:  "true" → only customers with orderCount > 1
 *
 * Response (200):
 *   {
 *     ok: true,
 *     generatedAt: ISO,
 *     counts: { total, repeat, oneAndDone, totalOrders, totalBags, totalRevenueUsd },
 *     customers: AmazonCustomerRecord[]
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** Never writes to KV / Slack / external systems.
 *   - **Fail-soft.** A KV scan failure surfaces as an empty list with
 *     ok:true (the helper already swallows internally) — the
 *     dashboard renders "no customers yet" rather than a stack trace.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  listAmazonCustomers,
  summarizeAmazonCustomers,
  type AmazonCustomerSortBy,
} from "@/lib/ops/amazon-customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
  const sortByRaw = url.searchParams.get("sortBy") ?? "lastSeen";
  const sortBy: AmazonCustomerSortBy =
    sortByRaw === "firstSeen" ||
    sortByRaw === "orderCount" ||
    sortByRaw === "totalRevenue"
      ? sortByRaw
      : "lastSeen";
  const repeatOnly = url.searchParams.get("repeatOnly") === "true";

  const customers = await listAmazonCustomers({ limit, sortBy, repeatOnly });
  const counts = summarizeAmazonCustomers(customers);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    counts,
    customers,
  });
}
