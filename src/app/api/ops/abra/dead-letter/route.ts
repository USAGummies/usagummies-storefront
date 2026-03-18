import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  getDeadLetterQueue,
  getPendingRetries,
  processRetries,
  abandonItem,
  clearRecovered,
} from "@/lib/ops/dead-letter-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// GET — Return the dead letter queue with counts
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queue = await getDeadLetterQueue();
  const pending = queue.filter((i) => i.status === "pending");
  const retrying = queue.filter((i) => i.status === "retrying");
  const recovered = queue.filter((i) => i.status === "recovered");
  const abandoned = queue.filter((i) => i.status === "abandoned");

  return NextResponse.json({
    total: queue.length,
    counts: {
      pending: pending.length,
      retrying: retrying.length,
      recovered: recovered.length,
      abandoned: abandoned.length,
    },
    items: queue,
  });
}

// ---------------------------------------------------------------------------
// POST — Process retries, abandon items, or clear recovered
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, id } = body;

  if (action === "retry") {
    const pendingItems = await getPendingRetries();
    if (pendingItems.length === 0) {
      return NextResponse.json({
        message: "No pending retries",
        retried: 0,
        recovered: 0,
        abandoned: 0,
      });
    }
    const stats = await processRetries();
    return NextResponse.json({
      message: `Processed ${stats.retried} retries`,
      ...stats,
    });
  }

  if (action === "abandon") {
    if (!id) {
      return NextResponse.json(
        { error: "Missing id for abandon action" },
        { status: 400 },
      );
    }
    await abandonItem(id);
    return NextResponse.json({ message: `Item ${id} abandoned` });
  }

  if (action === "clear") {
    const cleared = await clearRecovered();
    return NextResponse.json({
      message: `Cleared ${cleared} recovered items older than 7 days`,
      cleared,
    });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}` },
    { status: 400 },
  );
}
