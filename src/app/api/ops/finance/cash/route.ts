/**
 * GET /api/ops/finance/cash — Returns the cached cash position.
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { readState } from "@/lib/ops/state";
import type { CashPosition } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cashPosition = await readState<CashPosition | null>(
    "cash-position",
    null,
  );

  if (!cashPosition) {
    return NextResponse.json(
      {
        message:
          "No cash data available. Upload a Bank of America CSV export to populate.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json(cashPosition);
}
