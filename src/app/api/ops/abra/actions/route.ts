import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { executeAction, getAvailableActions } from "@/lib/ops/abra-actions";
import { validateRequest, ExecuteActionSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const v = await validateRequest(req, ExecuteActionSchema);
  if (!v.success) return v.response;
  const { approval_id: approvalId } = v.data;

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
