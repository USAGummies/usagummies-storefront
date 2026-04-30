/**
 * GET /api/ops/sales/tour
 *
 * Read-only projection of the canonical May 2026 sales-tour planning
 * contract. This route parses the checked-in markdown only. It never
 * sends email, writes HubSpot, opens approvals, calls Apollo, or mutates
 * any prospect record.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildSalesTourPlaybookReport } from "@/lib/sales/tour-playbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "contracts/sales-tour-may-2026-prospect-list.md";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const markdown = await readFile(join(process.cwd(), SOURCE), "utf8");
    const report = buildSalesTourPlaybookReport(markdown, {
      generatedAt: new Date().toISOString(),
      source: SOURCE,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "sales_tour_playbook_unavailable",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
