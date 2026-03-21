import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { rejectAction } from "@/lib/ops/abra-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const approvalId = (id || "").trim();
  if (!approvalId || !isUuidLike(approvalId)) {
    return NextResponse.json({ error: "Valid approval id is required" }, { status: 400 });
  }

  try {
    let reason = "Rejected by user";
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.reason === "string" && body.reason.trim()) {
        reason = body.reason.trim().slice(0, 500);
      }
    } catch {
      // No body is fine — default reason used
    }

    const result = await rejectAction(approvalId, reason);
    return NextResponse.json(
      { ok: result.success, approval_id: approvalId, message: result.message },
      { status: result.success ? 200 : 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reject action" },
      { status: 500 },
    );
  }
}
