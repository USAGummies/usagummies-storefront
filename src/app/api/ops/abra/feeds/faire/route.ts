import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runFeed } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function toStatus(success: boolean): number {
  if (success) return 200;
  return 424;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFeed("faire_orders");
    return NextResponse.json(
      {
        feed: "faire",
        status: result.success ? "ok" : "error",
        entriesCreated: result.entriesCreated,
        result,
      },
      { status: toStatus(result.success) },
    );
  } catch (error) {
    return NextResponse.json(
      {
        feed: "faire",
        status: "error",
        entriesCreated: 0,
        error: error instanceof Error ? error.message : "Faire feed failed",
      },
      { status: 424 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
