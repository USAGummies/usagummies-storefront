/**
 * GET /api/ops/sales/prospects/day1
 *
 * Read-only projection of the curated Day 1 wholesale prospect CSV.
 * This route does not send email, create HubSpot contacts/deals, write
 * KV, or call Apollo/Gmail. It only parses the checked-in CSV so
 * operators can see which prospects are email-ready versus manual
 * research / phone / RangeMe paths.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildProspectPlaybookReport } from "@/lib/sales/prospect-playbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "docs/playbooks/wholesale-prospects-day1.csv";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const csv = await readFile(join(process.cwd(), SOURCE), "utf8");
    const report = buildProspectPlaybookReport(csv, {
      generatedAt: new Date().toISOString(),
      source: SOURCE,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "prospect_playbook_unavailable",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
