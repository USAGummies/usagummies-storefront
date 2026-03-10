import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { notify } from "@/lib/ops/notify";
import { runEmailFetch } from "@/lib/ops/abra-email-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { limit?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsedLimit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(200, Math.trunc(body.limit)))
      : 50;

  try {
    const result = await runEmailFetch({ count: parsedLimit });
    return NextResponse.json({
      fetched: result.fetched,
      new: result.inserted,
      signals: result.signals,
      skipped: result.skipped,
      ...(result.note ? { note: result.note } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Email fetch failed";
    console.error("[abra-email-fetch] failed:", error);
    void notify({
      channel: "alerts",
      text: `🚨 Abra email fetch failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
