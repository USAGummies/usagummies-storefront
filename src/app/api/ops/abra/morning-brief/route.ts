import { NextResponse } from "next/server";
import { isAuthorized, isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  generateMorningBrief,
  generateMorningBriefPayload,
  sendMorningBrief,
} from "@/lib/ops/abra-morning-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [payload, briefText] = await Promise.all([
      generateMorningBriefPayload(),
      generateMorningBrief(),
    ]);
    return NextResponse.json({
      ok: true,
      route: "morning-brief",
      payload,
      brief: briefText,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate morning brief preview",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
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
