import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listCommitments, upsertCommitment, completeCommitment } from "@/lib/ops/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner") || undefined;
    const status = url.searchParams.get("status") as any;
    const commitments = await listCommitments({ owner, status });
    return NextResponse.json({ ok: true, commitments, count: commitments.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list commitments" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.id || !body.owner || !body.description) {
      return NextResponse.json({ error: "Required: id, owner, description" }, { status: 400 });
    }
    const commitment = await upsertCommitment({
      id: body.id, owner: body.owner, description: body.description,
      deadline: body.deadline, source_channel: body.source_channel,
      source_thread: body.source_thread, status: body.status || "committed",
      notes: body.notes,
    });
    return NextResponse.json({ ok: true, commitment });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save commitment" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "Required: id" }, { status: 400 });
    const commitment = await completeCommitment(body.id);
    if (!commitment) return NextResponse.json({ error: "Commitment not found" }, { status: 404 });
    return NextResponse.json({ ok: true, commitment });
  } catch (error) {
    return NextResponse.json({ error: "Failed to complete commitment" }, { status: 500 });
  }
}
