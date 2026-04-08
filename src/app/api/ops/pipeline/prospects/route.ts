/**
 * GET /api/ops/pipeline/prospects — List prospects with filters
 * POST /api/ops/pipeline/prospects — Upsert a prospect
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listProspects, upsertProspect, deleteProspect } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as any;
  const channel_type = url.searchParams.get("channel_type") as any;
  const region = url.searchParams.get("region") as any;
  const min_score = url.searchParams.get("min_score");
  const limit = url.searchParams.get("limit");

  const prospects = await listProspects({
    status: status || undefined,
    channel_type: channel_type || undefined,
    region: region || undefined,
    min_score: min_score ? parseInt(min_score) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  });

  return NextResponse.json({ prospects, count: prospects.length });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const prospect = await upsertProspect(body);
    return NextResponse.json({ prospect });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upsert prospect" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Required query param: id" },
      { status: 400 },
    );
  }

  const result = await deleteProspect(id);
  if (!result.deleted) {
    return NextResponse.json(
      { error: `Prospect not found: ${id}` },
      { status: 404 },
    );
  }

  return NextResponse.json({ deleted: true, id });
}
