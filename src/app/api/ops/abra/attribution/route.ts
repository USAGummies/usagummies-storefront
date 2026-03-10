import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { generateAttributionReport } from "@/lib/ops/abra-attribution";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
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
