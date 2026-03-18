import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  buildMonthlyStatementPeriod,
  buildQuarterlyStatementPeriod,
  buildYtdStatementPeriod,
  formatPnLAsText,
  generatePnL,
} from "@/lib/ops/abra-financial-statements";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StatementRequest = {
  period?: "monthly" | "quarterly" | "ytd";
  month?: number;
  year?: number;
};

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as StatementRequest;
    const periodType = body.period || "monthly";

    const period =
      periodType === "quarterly"
        ? buildQuarterlyStatementPeriod(body.month, body.year)
        : periodType === "ytd"
          ? buildYtdStatementPeriod(body.year)
          : buildMonthlyStatementPeriod(body.month, body.year);

    const statement = await generatePnL(period);
    await notify({
      channel: "daily",
      text: formatPnLAsText(statement),
    });

    return NextResponse.json(statement);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate financial statement",
      },
      { status: 500 },
    );
  }
}
