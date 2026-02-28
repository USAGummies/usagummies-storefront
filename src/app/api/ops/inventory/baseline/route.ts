/**
 * GET/POST /api/ops/inventory/baseline
 *
 * Stores the physical-count baseline for home-stock reconciliation.
 */

import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HomeStockBaseline = {
  pa: number;
  wa: number;
  asOf: string;
  note?: string;
  updatedAt?: string;
};

const DEFAULT_HOME_BASELINE: HomeStockBaseline = {
  pa: 88,
  wa: 42,
  asOf: "2026-02-09",
  note: "Initial physical count",
};

export async function GET() {
  const baseline = await readState<HomeStockBaseline>(
    "home-stock-baseline",
    DEFAULT_HOME_BASELINE,
  );
  return NextResponse.json({
    ...baseline,
    updatedAt: baseline.updatedAt || null,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      pa?: number;
      wa?: number;
      asOf?: string;
      note?: string;
    };

    const pa = Number(body.pa);
    const wa = Number(body.wa);
    const asOf = String(body.asOf || "").trim();
    const note = String(body.note || "").trim();

    if (!Number.isFinite(pa) || pa < 0 || !Number.isFinite(wa) || wa < 0) {
      return NextResponse.json(
        { error: "pa and wa must be non-negative numbers" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json(
        { error: "asOf must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const baseline: HomeStockBaseline = {
      pa: Math.round(pa),
      wa: Math.round(wa),
      asOf,
      ...(note ? { note } : {}),
      updatedAt: new Date().toISOString(),
    };

    await writeState("home-stock-baseline", baseline);
    return NextResponse.json({
      ok: true,
      baseline,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
