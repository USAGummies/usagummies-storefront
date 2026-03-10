import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { generateRevenueForecast } from "@/lib/ops/abra-forecasting";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return Boolean(secret && authHeader === `Bearer ${secret}`);
}

function parseDays(value: string | null): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.floor(parsed), 1), 90);
}

function parseChannel(value: string | null): "all" | "shopify" | "amazon" | "total" {
  if (value === "shopify" || value === "amazon" || value === "total") return value;
  return "all";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const channel = parseChannel(url.searchParams.get("channel"));
    const forecasts = await generateRevenueForecast({
      days_ahead: days,
      channel,
    });
    return NextResponse.json({
      forecasts,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate forecast";
    console.error("[abra-forecast] GET failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Abra forecast API failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
