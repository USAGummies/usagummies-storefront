import { NextResponse } from "next/server";
import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await sendMorningBrief();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send morning brief",
      },
      { status: 500 },
    );
  }
}
