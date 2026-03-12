import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runFeed } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isConfigError(message?: string): boolean {
  return /not configured|missing .*creds?|credentials/i.test(message || "");
}

function toStatus(success: boolean, error?: string): number {
  if (success) return 200;
  if (isConfigError(error)) return 424;
  return 502;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runFeed("ga4_traffic");
  return NextResponse.json(
    {
      feed: "ga4",
      status: result.success ? "ok" : "error",
      entriesCreated: result.entriesCreated,
      result,
    },
    { status: toStatus(result.success, result.error) },
  );
}

export async function GET(req: Request) {
  return POST(req);
}
