import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  cancelWorkflow,
  getWorkflowRun,
  resumeWorkflow,
} from "@/lib/ops/workflow-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const run = await getWorkflowRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  let body: { decision?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const decision =
    body.decision === "denied" ? "denied" : "approved";
  const run = await resumeWorkflow(runId, decision);
  return NextResponse.json({ run });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  await cancelWorkflow(runId);
  return NextResponse.json({ ok: true, runId });
}
