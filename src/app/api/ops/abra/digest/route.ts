import { NextResponse } from "next/server";
import {
  sendMonthlyReport,
  sendWeeklyDigest,
} from "@/lib/ops/abra-weekly-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && authHeader === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") || "weekly").toLowerCase();

  try {
    if (type === "weekly") {
      await sendWeeklyDigest();
      return NextResponse.json({ ok: true, type: "weekly" });
    }

    if (type === "monthly") {
      await sendMonthlyReport();
      return NextResponse.json({ ok: true, type: "monthly" });
    }

    return NextResponse.json(
      { error: "Invalid type. Use weekly or monthly." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run digest",
      },
      { status: 500 },
    );
  }
}
