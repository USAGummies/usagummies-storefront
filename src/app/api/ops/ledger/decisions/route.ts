import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listDecisions, upsertDecision, resolveDecision } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || undefined;
    const status = url.searchParams.get("status") as "resolved" | "pending" | "superseded" | undefined;

    const decisions = await listDecisions({ topic, status });
    return NextResponse.json({ ok: true, decisions, count: decisions.length });
  } catch (error) {
    console.error("[ledger/decisions] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list decisions" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.topic || !body.decision || !body.decided_by) {
      return NextResponse.json(
        { error: "Required: id, topic, decision, decided_by" },
        { status: 400 }
      );
    }

    const decision = await upsertDecision({
      id: body.id,
      topic: body.topic,
      decision: body.decision,
      decided_by: body.decided_by,
      date: body.date || new Date().toISOString().split("T")[0],
      source_thread: body.source_thread,
      status: body.status || "resolved",
      superseded_by: body.superseded_by,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    console.error("[ledger/decisions] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save decision" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.decision || !body.decided_by) {
      return NextResponse.json(
        { error: "Required: id, decision, decided_by" },
        { status: 400 }
      );
    }

    const decision = await resolveDecision(body.id, body.decision, body.decided_by);
    if (!decision) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    console.error("[ledger/decisions] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to resolve decision" }, { status: 500 });
  }
}
