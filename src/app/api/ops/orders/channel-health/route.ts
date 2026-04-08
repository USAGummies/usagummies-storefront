import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannelHealth } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const channels = await getChannelHealth();
    return NextResponse.json({ ok: true, channels, count: channels.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get channel health" }, { status: 500 });
  }
}
