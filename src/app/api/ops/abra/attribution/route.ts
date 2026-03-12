import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { generateAttributionReport } from "@/lib/ops/abra-attribution";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePeriodDays(value: string | null): number {
  if (!value) return 30;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 30;
  const match = normalized.match(/^(\d+)\s*d?$/);
  if (!match) return 30;
  const days = Number(match[1]);
  if (!Number.isFinite(days)) return 30;
  return Math.min(Math.max(Math.floor(days), 7), 180);
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const periodDays = parsePeriodDays(url.searchParams.get("period"));
    const report = await generateAttributionReport(periodDays);
    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate attribution report";
    console.error("[abra-attribution] GET failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Attribution API failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
