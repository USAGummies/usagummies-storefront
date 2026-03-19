/**
 * GET  /api/ops/abra/backlog — List active backlog items
 * POST /api/ops/abra/backlog — Seed the operational backlog (idempotent)
 */
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getActiveBacklog,
  seedOperationalBacklog,
} from "@/lib/ops/abra-operational-backlog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const items = await getActiveBacklog();
    return NextResponse.json({
      count: items.length,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load backlog" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await seedOperationalBacklog();
    return NextResponse.json({
      message: result.created > 0
        ? `Seeded ${result.created} operational backlog items`
        : `Backlog already has ${result.skipped} items — no new items created`,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seed backlog" },
      { status: 500 },
    );
  }
}
