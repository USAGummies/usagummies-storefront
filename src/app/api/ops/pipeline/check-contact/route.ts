/**
 * POST /api/ops/pipeline/check-contact — Outreach dedup check
 *
 * Before sending outreach, Viktor calls this to check if a company/email
 * already exists in the pipeline. Returns existing prospect + touch history.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkContact } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await checkContact(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to check contact" },
      { status: 400 },
    );
  }
}
