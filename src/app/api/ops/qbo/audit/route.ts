/**
 * GET /api/ops/qbo/audit — View QBO audit log
 *
 * Query params:
 *   ?entity_type=invoice — filter by entity type
 *   ?errors_only=true — only show failed validations
 *   ?limit=50 — max entries to return (default 100)
 *
 * Returns: { entries: [...], count }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getQBOAuditLog } from "@/lib/ops/qbo-guardrails";
import type { QBOEntityType } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entity_type") as QBOEntityType | null;
  const errorsOnly = url.searchParams.get("errors_only") === "true";
  const limit = url.searchParams.get("limit");

  const entries = await getQBOAuditLog({
    entity_type: entityType || undefined,
    errors_only: errorsOnly,
    limit: limit ? parseInt(limit) : undefined,
  });

  return NextResponse.json({
    entries,
    count: entries.length,
    generated_at: new Date().toISOString(),
  });
}
