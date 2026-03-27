import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";
import { runOperatorLoop } from "@/lib/ops/operator/operator-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getPTNow(): Date {
  const now = new Date();
  const pt = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(pt);
}

function inMorningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour === 8;
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowPT = getPTNow();
  const steps: Array<{ name: string; ok: boolean; error?: string }> = [];

  try {
    await runOperatorLoop();
    steps.push({ name: "operator", ok: true });
  } catch (error) {
    steps.push({
      name: "operator",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (inMorningWindow(nowPT)) {
    try {
      await sendMorningBrief();
      steps.push({ name: "morning_brief", ok: true });
    } catch (error) {
      steps.push({
        name: "morning_brief",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ok = steps.every((step) => step.ok);
  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      steps,
    },
    { status: ok ? 200 : 207 },
  );
}
