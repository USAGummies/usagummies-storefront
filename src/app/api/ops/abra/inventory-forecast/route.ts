import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  analyzeInventory,
  checkAndAlertReorders,
} from "@/lib/ops/abra-inventory-forecast";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return Boolean(secret && authHeader === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const forecasts = await analyzeInventory();
    return NextResponse.json({ forecasts, generated_at: new Date().toISOString() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze inventory";
    console.error("[abra-inventory-forecast] GET failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Inventory forecast API failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await checkAndAlertReorders();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to run reorder checks";
    console.error("[abra-inventory-forecast] POST failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Inventory reorder check failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
