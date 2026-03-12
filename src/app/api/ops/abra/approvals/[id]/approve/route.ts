import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { executeAction } from "@/lib/ops/abra-actions";

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
  if (!approvalId) {
    return NextResponse.json({ error: "Approval id is required" }, { status: 400 });
  }
  if (!isUuidLike(approvalId)) {
    return NextResponse.json({ error: "Approval id must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await executeAction(approvalId);
    if (!result.success) {
      return NextResponse.json(
        {
          ok: false,
          approval_id: approvalId,
          error: result.message,
          result,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      approval_id: approvalId,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve action" },
      { status: 500 },
    );
  }
}
