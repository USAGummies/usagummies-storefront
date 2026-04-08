import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getEntryHistory } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const entryId = url.searchParams.get("entry_id");
    if (!entryId) return NextResponse.json({ error: "Required: entry_id query param" }, { status: 400 });
    const history = await getEntryHistory(entryId);
    return NextResponse.json({ ok: true, versions: history, count: history.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get entry history" }, { status: 500 });
  }
}
