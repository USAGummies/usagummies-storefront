/**
 * GET /api/ops/fulfillment/summary
 *
 * Weekly KPI rollup for the Shipping Hub. Consolidates:
 *   - Label buy volume (count + $, active vs voided, per-carrier)
 *   - Freight-comp queue drain (queued / posted / rejected)
 *   - Wallet balances + floor status
 *   - Stale-void refund age distribution
 *   - Inventory snapshot staleness
 *
 * Designed for the weekly Monday drift-audit post + Ben's ad-hoc
 * "how's shipping doing?" read. Pure read, no side effects.
 *
 * Query params:
 *   - daysBack: default 7, clamped 1-30
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { computeFulfillmentPreflight } from "@/lib/ops/fulfillment-preflight";
import { getRecentShipments } from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

interface FreightCompQueueEntry {
  queuedAt: string;
  freightDollars: number;
  status: "queued" | "approved" | "posted" | "rejected";
  approvedAt?: string;
  postedAt?: string;
  rejectedAt?: string;
}

function clampInt(
  s: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const daysBack = clampInt(url.searchParams.get("daysBack"), 7, 1, 30);

  const now = Date.now();
  const windowStart = now - daysBack * 24 * 3600 * 1000;
  const shipStart = new Date(windowStart).toISOString().slice(0, 10);

  // --- Shipments in window ---
  const [shipRes, preflight, queueRaw] = await Promise.all([
    getRecentShipments({
      shipDateStart: shipStart,
      includeVoided: true,
      pageSize: 500,
    }),
    computeFulfillmentPreflight(),
    (async () =>
      ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
        []) as FreightCompQueueEntry[])(),
  ]);

  const shipments = shipRes.ok ? shipRes.shipments : [];
  const degraded: string[] = [];
  if (!shipRes.ok) degraded.push(`shipstation: ${shipRes.error}`);

  const active = shipments.filter((s) => !s.voided);
  const voided = shipments.filter((s) => s.voided);
  const activeSpend =
    Math.round(
      active.reduce((sum, s) => sum + (s.shipmentCost ?? 0), 0) * 100,
    ) / 100;
  const voidedPending =
    Math.round(
      voided.reduce((sum, s) => sum + (s.shipmentCost ?? 0), 0) * 100,
    ) / 100;

  const byCarrier: Record<
    string,
    { active: number; voided: number; activeDollars: number }
  > = {};
  for (const s of shipments) {
    const key = s.carrierCode ?? "unknown";
    const b = byCarrier[key] ?? { active: 0, voided: 0, activeDollars: 0 };
    if (s.voided) {
      b.voided += 1;
    } else {
      b.active += 1;
      b.activeDollars =
        Math.round((b.activeDollars + (s.shipmentCost ?? 0)) * 100) / 100;
    }
    byCarrier[key] = b;
  }

  // --- Freight-comp queue transitions in window ---
  const inWindow = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= windowStart;
  };
  const queuedInWin = queueRaw.filter((q) => inWindow(q.queuedAt));
  const postedInWin = queueRaw.filter((q) => inWindow(q.postedAt));
  const rejectedInWin = queueRaw.filter((q) => inWindow(q.rejectedAt));
  const sumDollars = (xs: FreightCompQueueEntry[]) =>
    Math.round(xs.reduce((a, x) => a + (x.freightDollars || 0), 0) * 100) / 100;

  // --- Drain ratio ---
  const openQueue = queueRaw.filter((q) => q.status === "queued").length;
  const totalResolved = postedInWin.length + rejectedInWin.length;
  const drainRatio =
    queuedInWin.length > 0
      ? Math.round((totalResolved / queuedInWin.length) * 1000) / 10
      : null;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    daysBack,
    labels: {
      total: shipments.length,
      active: active.length,
      voided: voided.length,
      activeSpend,
      voidedPending,
      byCarrier,
    },
    freightCompQueue: {
      queuedInWindow: {
        count: queuedInWin.length,
        dollars: sumDollars(queuedInWin),
      },
      postedInWindow: {
        count: postedInWin.length,
        dollars: sumDollars(postedInWin),
      },
      rejectedInWindow: {
        count: rejectedInWin.length,
        dollars: sumDollars(rejectedInWin),
      },
      currentlyOpen: openQueue,
      drainRatioPct: drainRatio, // resolved in window / queued in window, pct
    },
    wallets: preflight.wallets,
    walletDegraded: preflight.walletDegraded,
    staleVoids: preflight.staleVoids,
    atp: preflight.atp,
    degraded,
  });
}
