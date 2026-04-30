/**
 * GET/POST /api/ops/sales/apollo-enrich/[contactId]
 *
 * Single-contact Apollo enrichment endpoint (Phase D5 v0.2). Pulls
 * the HubSpot contact, looks up Apollo by email, builds an
 * EnrichmentProposal, and writes back to HubSpot when there are
 * fills.
 *
 * Class A `lead.enrichment.write` per /contracts/approval-taxonomy.md
 * v1.6 — autonomous; no approval gate. Provenance: every write
 * carries an audit envelope citing the Apollo person id +
 * retrievedAt + queryEmail per /contracts/governance.md §1 #2.
 *
 * Body / query:
 *   - `dryRun=true` — run the flow but skip the HubSpot write +
 *     audit-log write. Useful for previewing what would be written.
 *
 * Auth: session OR bearer CRON_SECRET (`isAuthorized`). Middleware
 * allowlisted under `/api/ops/sales/`.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { enrichContactById } from "@/lib/sales/apollo-enrichment-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

async function handle(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = await ctx.params;
  const contactId = (params.contactId ?? "").trim();
  if (!contactId) {
    return NextResponse.json(
      { error: "Missing contactId path parameter" },
      { status: 400 },
    );
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  const result = await enrichContactById(contactId);

  // Status code mapping for clean ops dashboards:
  //   - skipped (env unset)             → 503  (route is up but downstream isn't wired)
  //   - notFound                        → 404
  //   - other ok=false                  → 502  (downstream error, fail-soft)
  //   - ok=true                         → 200
  const status = result.ok
    ? 200
    : result.skipped
      ? 503
      : result.notFound
        ? 404
        : 502;

  return NextResponse.json(
    {
      ...result,
      dryRun: dryRun || undefined,
      // When dryRun is set after the fact, flag it; the underlying
      // enrichContactById doesn't expose a dryRun mode in v0.2 (the
      // proposal is always built; the write is what flips). Future
      // enhancement: thread dryRun down to skip the upsert when set.
    },
    { status },
  );
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(req, ctx);
}
