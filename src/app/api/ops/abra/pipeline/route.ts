import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  analyzePipeline,
  checkDealHealth,
} from "@/lib/ops/abra-pipeline-intelligence";
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
    const summary = await analyzePipeline();
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze pipeline";
    console.error("[abra-pipeline] GET failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Pipeline intelligence API failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await checkDealHealth();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run pipeline health";
    console.error("[abra-pipeline] POST failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Pipeline health run failed: ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
