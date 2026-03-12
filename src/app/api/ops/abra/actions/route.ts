import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { executeAction, getAvailableActions } from "@/lib/ops/abra-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    actions: getAvailableActions(),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { approval_id?: unknown; confirm?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const approvalId =
    typeof payload.approval_id === "string" ? payload.approval_id.trim() : "";
  const confirm = payload.confirm === true;
  if (!approvalId) {
    return NextResponse.json({ error: "approval_id is required" }, { status: 400 });
  }
  if (!isUuidLike(approvalId)) {
    return NextResponse.json({ error: "approval_id must be a valid UUID" }, { status: 400 });
  }
  if (!confirm) {
    return NextResponse.json({ error: "confirm must be true" }, { status: 400 });
  }

  try {
    const result = await executeAction(approvalId);
    return NextResponse.json({
      ok: result.success,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Action execution failed",
      },
      { status: 500 },
    );
  }
}
