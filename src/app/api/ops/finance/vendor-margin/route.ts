/**
 * GET /api/ops/finance/vendor-margin
 *
 * Read-only JSON view over /contracts/per-vendor-margin-ledger.md.
 * Auth-gated. No QBO/HubSpot/Shopify/Gmail/Slack calls and no writes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  parsePerVendorMarginLedger,
  slugifyVendorName,
} from "@/lib/finance/per-vendor-margin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEDGER_PATH = join(process.cwd(), "contracts/per-vendor-margin-ledger.md");

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const vendorQuery = url.searchParams.get("vendor")?.trim() ?? "";

  try {
    const markdown = await readFile(LEDGER_PATH, "utf8");
    const ledger = parsePerVendorMarginLedger(markdown);
    const requestedSlug = vendorQuery ? slugifyVendorName(vendorQuery) : null;
    const vendor = requestedSlug
      ? ledger.committedVendors.find(
          (row) =>
            row.slug === requestedSlug ||
            row.slug.includes(requestedSlug) ||
            row.name.toLowerCase().includes(vendorQuery.toLowerCase()),
        ) ?? null
      : null;

    if (requestedSlug && !vendor) {
      return NextResponse.json(
        {
          ok: false,
          code: "vendor_not_found",
          error: `No committed vendor margin row found for "${vendorQuery}".`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      source: {
        path: "contracts/per-vendor-margin-ledger.md",
        status: ledger.status,
        version: ledger.version,
      },
      counts: {
        committedVendors: ledger.committedVendors.length,
        channelRows: ledger.channelRows.length,
        pendingVendors: ledger.pendingVendors.length,
      },
      vendor,
      ledger: requestedSlug ? undefined : ledger,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "ledger_read_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
