import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runReconciliation, getReconciliationHistory } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "30");
    const history = await getReconciliationHistory(limit);
    return NextResponse.json({ ok: true, reconciliations: history, count: history.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get reconciliation history" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runReconciliation();
    return NextResponse.json({ ok: true, reconciliation: result });
  } catch (error) {
    return NextResponse.json({ error: "Failed to run reconciliation" }, { status: 500 });
  }
}
