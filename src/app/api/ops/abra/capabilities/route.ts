import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getAllCapabilities } from "@/lib/ops/capability-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getAllCapabilities();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[capabilities] failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load capabilities",
      },
      { status: 500 },
    );
  }
}
