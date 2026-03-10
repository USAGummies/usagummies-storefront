import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { generateWeeklyDigest } from "@/lib/ops/abra-accuracy-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const digest = await generateWeeklyDigest();
    return NextResponse.json({ ok: true, digest });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate weekly digest",
      },
      { status: 500 },
    );
  }
}
