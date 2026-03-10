import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { generateAttributionReport } from "@/lib/ops/abra-attribution";
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
    const report = await generateAttributionReport();
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
