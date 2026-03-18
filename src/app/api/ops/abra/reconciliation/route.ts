import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  buildReconciliationPeriod,
  formatReconciliationAsText,
  generateReconciliationReport,
} from "@/lib/ops/revenue-reconciliation";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ReconciliationRequest = {
  month?: number;
  year?: number;
};

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ReconciliationRequest;
    const period = buildReconciliationPeriod(body.month, body.year);
    const report = await generateReconciliationReport(period);

    await notify({
      channel: "daily",
      text: formatReconciliationAsText(report),
    });

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate reconciliation report",
      },
      { status: 500 },
    );
  }
}
