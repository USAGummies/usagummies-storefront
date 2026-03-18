import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { sendWeeklyDigest } = await import("@/lib/ops/abra-weekly-digest");
    await sendWeeklyDigest();
    return NextResponse.json({ ok: true, message: "Weekly digest posted to Slack" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[weekly-digest] Failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { generateWeeklyDigestPreview } = await import("@/lib/ops/abra-weekly-digest");
    const preview = await generateWeeklyDigestPreview();
    return NextResponse.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
