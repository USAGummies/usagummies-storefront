/**
 * GET /api/ops/fulfillment/preflight
 *
 * Consolidated Shipping Hub pre-flight. One payload answering:
 *   - Can I buy a label right now? (wallet + carriers)
 *   - How much inventory is on hand + pending outbound? (ATP)
 *   - What's in Rene's queue from my past buys? (freight-comp)
 *   - Any refunds owed to me? (stale voids)
 *
 * Consumers:
 *   - Ops Agent morning #operations digest (folds alerts inline)
 *   - Executive Brief morning (future wire)
 *   - Future Shipping Hub UI pre-ship banner
 *
 * Pure read. No side-effects. Implementation lives in
 * `src/lib/ops/fulfillment-preflight.ts` so callers can share.
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { computeFulfillmentPreflight } from "@/lib/ops/fulfillment-preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  // Session OR bearer CRON_SECRET — so Ben's browser at /ops/shipping
  // and the Vercel cron can both consume the same payload.
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await computeFulfillmentPreflight();
  return NextResponse.json(result);
}
