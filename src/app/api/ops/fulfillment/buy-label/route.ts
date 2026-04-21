/**
 * Buy a UPS Ground shipping label for one or more items in the fulfillment
 * queue. Part of Phase 2 of the Shipping Hub.
 *
 * POST body:
 *   {
 *     keys: string[],          // e.g. ["inv:1535", "pending:inderbitzin-po-009180-remainder"]
 *     destination: {...},      // ship-to address (mandatory for now — we don't auto-infer)
 *     packagingType: "case" | "master_carton",
 *     cartons?: number,        // defaults to sum of cartonsRequired across keys
 *     dryRun?: boolean         // if true, return a quote only (no purchase)
 *   }
 *
 * For each master carton we call ShipStation createLabel once (one tracking
 * per box). All labels share the same ship-to. After purchase we write the
 * tracking # back to each key in the stage map and auto-advance to "ready".
 * Ben marks shipped separately (or the webhook in Phase 3 does it).
 *
 * Auth: session or bearer CRON_SECRET (via middleware whitelist).
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createShippingLabel,
  findRecentShipmentByAddress,
  getCheapestShipStationRate,
  preflightWalletCheck,
  type LabelDestination,
  type LabelResult,
} from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the stage shape in ../route.ts without re-exporting to avoid
// App Router route-export restrictions.
interface StageEntry {
  stage: "received" | "packed" | "ready" | "shipped";
  cartonsRequired: number;
  cartonsPacked: number;
  tracking?: string;
  labelUrl?: string;
  labelCost?: number;
  carrier?: string;
  service?: string;
  notes?: string;
  receivedAt: string;
  packedAt?: string;
  readyAt?: string;
  shippedAt?: string;
  updatedBy?: string;
  updatedAt: string;
}
type StageMap = Record<string, StageEntry>;

const KV_STAGES = "fulfillment:stages";

interface BuyLabelRequest {
  keys?: string[];
  destination?: LabelDestination;
  packagingType?: "case" | "master_carton";
  cartons?: number;
  dryRun?: boolean;
  updatedBy?: string;
  /** Pin a specific carrier+service (from a prior rate-shop). Optional. */
  carrierCode?: string;
  serviceCode?: string;
  /**
   * Escape hatch for preflight wallet gating. Default: true (we fail
   * closed when the wallet can't cover cost × 1.2). Set false to
   * override — e.g. when Ben has just topped up out-of-band and the
   * /carriers cache hasn't refreshed. BUILD #2.
   */
  preflightWallet?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BuyLabelRequest;
  try {
    body = (await req.json()) as BuyLabelRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keys = Array.isArray(body.keys) ? body.keys.filter(Boolean) : [];
  if (keys.length === 0) {
    return NextResponse.json({ error: "keys[] required" }, { status: 400 });
  }
  if (!body.destination) {
    return NextResponse.json({ error: "destination required" }, { status: 400 });
  }
  const packagingType = body.packagingType ?? "master_carton";

  const stages: StageMap = ((await kv.get<StageMap>(KV_STAGES)) ?? {}) as StageMap;

  // Compute cartons to buy = explicit override OR sum of cartonsRequired.
  const defaultCartonCount = keys.reduce((sum, k) => {
    const entry = stages[k];
    return sum + (entry?.cartonsRequired ? entry.cartonsRequired : 1);
  }, 0);
  const cartonCount = Math.max(1, body.cartons ?? defaultCartonCount);

  // Rate-shop to pick the cheapest connected carrier unless the caller
  // already pinned one. Runs once for the whole order since every carton
  // goes to the same destination with the same packaging profile.
  let carrierCode = body.carrierCode;
  let serviceCode = body.serviceCode;
  let ratePreview: { perPackage: number; total: number; carrier: string; service: string } | null = null;

  if (!carrierCode || !serviceCode) {
    const rate = await getCheapestShipStationRate({
      toZip: body.destination.postalCode,
      toState: body.destination.state,
      packagingType,
      quantity: cartonCount,
      residential: body.destination.residential,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: `rate-shop failed: ${rate.error}` },
        { status: 502 },
      );
    }
    carrierCode = rate.quote.carrierCode;
    serviceCode = rate.quote.serviceCode;
    ratePreview = {
      perPackage: rate.quote.perPackage,
      total: rate.quote.rate,
      carrier: rate.quote.carrier,
      service: rate.quote.service,
    };
  }

  // BUILD #2 — preflight wallet check. Refuses the buy loop if the
  // carrier's wallet can't cover cost × 1.2 (headroom for surcharges).
  // Skipped cleanly for non-walleted carriers. See shipstation-client.ts.
  const preflightEnabled = body.preflightWallet !== false;
  const estimatedTotalCost = ratePreview?.total ?? 0;
  let walletPreflight: {
    balance: number | null;
    required: number;
    safetyMultiplier: number;
    skipped: boolean;
  } | null = null;
  if (preflightEnabled && carrierCode && estimatedTotalCost > 0) {
    const pf = await preflightWalletCheck({
      carrierCode,
      costDollars: estimatedTotalCost,
    });
    walletPreflight = {
      balance: pf.balance,
      required: pf.required,
      safetyMultiplier: pf.safetyMultiplier,
      skipped: pf.skipped,
    };
    if (!pf.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: pf.error ?? "Wallet preflight failed",
          walletPreflight,
          pickedCarrier: carrierCode,
          ratePreview,
        },
        { status: 402 },
      );
    }
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldBuy: cartonCount,
      keys,
      destination: body.destination,
      pickedCarrier: carrierCode,
      pickedService: serviceCode,
      ratePreview,
      walletPreflight,
    });
  }

  const labels: LabelResult[] = [];
  const errors: string[] = [];
  /** Candidate shipments the 504-recovery helper surfaced. Ops inspects. */
  const recoveredCandidates: Array<{
    carton: number;
    candidates: Array<{
      shipmentId: number;
      trackingNumber: string | null;
      carrierCode: string | null;
      serviceCode: string | null;
      createDate: string;
    }>;
  }> = [];

  // Buy one label per carton, identical destination + carrier + service.
  const buyLoopStart = new Date();
  for (let i = 0; i < cartonCount; i++) {
    const orderNumber = `${keys.join("+")}#${i + 1}/${cartonCount}`;
    const res = await createShippingLabel({
      destination: body.destination,
      packagingType,
      carrierCode,
      serviceCode,
      orderNumber,
      customerNotes: keys.join(", "),
    });
    if (res.ok) {
      labels.push(res.label);
      continue;
    }

    // BUILD #3 — 504 idempotency recovery. When the response was a
    // gateway timeout (502/503/504/timeout), the shipment MAY have
    // been created server-side. Do NOT auto-retry — that's how we
    // triple-bought Red Dog on 2026-04-20. Instead: query recent
    // shipments matching the destination, surface them to the
    // operator, and stop the loop.
    const errStr = res.error || "";
    const looksLikeTimeout = /\b(504|502|503|timeout|ETIMEDOUT|ECONNRESET)\b/i.test(
      errStr,
    );
    if (looksLikeTimeout) {
      const candidates = await findRecentShipmentByAddress({
        shipToPostalCode: body.destination.postalCode,
        shipToName: body.destination.name,
        withinMinutes: Math.max(
          2,
          Math.ceil((Date.now() - buyLoopStart.getTime()) / 60_000) + 2,
        ),
      });
      recoveredCandidates.push({
        carton: i + 1,
        candidates: candidates.slice(0, 5).map((c) => ({
          shipmentId: c.shipmentId,
          trackingNumber: c.trackingNumber,
          carrierCode: c.carrierCode,
          serviceCode: c.serviceCode,
          createDate: c.createDate,
        })),
      });
      errors.push(
        `carton ${i + 1}/${cartonCount}: TIMEOUT — ${errStr}. ` +
          `Found ${candidates.length} candidate shipment(s) created in last few min — ` +
          `verify in ShipStation UI before retrying (may be silent-success).`,
      );
      break; // DO NOT auto-retry
    }

    errors.push(`carton ${i + 1}/${cartonCount}: ${res.error}`);
    break; // fail-fast; leave already-purchased labels in place
  }

  if (labels.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: errors.join(" | ") || "No labels purchased",
        recoveredCandidates,
        walletPreflight,
      },
      { status: 502 },
    );
  }

  // Write tracking back to each key. For a multi-carton single-destination
  // order, each key gets the concatenated list of tracking numbers.
  const now = new Date().toISOString();
  const trackingJoined = labels.map((l) => l.trackingNumber).join(", ");
  const labelUrls = labels.map((l) => l.labelUrl).filter(Boolean);
  const totalCost = labels.reduce((a, l) => a + l.cost, 0);

  const updatedStages: StageMap = { ...stages };
  for (const key of keys) {
    const prev: StageEntry =
      updatedStages[key] ?? {
        stage: "received",
        cartonsRequired: cartonCount,
        cartonsPacked: 0,
        receivedAt: now,
        updatedAt: now,
      };
    const nextStage: StageEntry["stage"] =
      prev.stage === "shipped" ? "shipped" : "ready";
    const firstLabel = labels[0];
    updatedStages[key] = {
      ...prev,
      stage: nextStage,
      readyAt: prev.readyAt ?? now,
      tracking: trackingJoined,
      labelUrl: labelUrls[0] ?? prev.labelUrl,
      labelCost: (prev.labelCost ?? 0) + totalCost,
      carrier: firstLabel?.carrier ?? prev.carrier,
      service: firstLabel?.service ?? prev.service,
      updatedAt: now,
      updatedBy: body.updatedBy?.trim() || prev.updatedBy,
    };
  }

  await kv.set(KV_STAGES, updatedStages);

  return NextResponse.json({
    ok: true,
    purchased: labels.length,
    totalCost: Math.round(totalCost * 100) / 100,
    labels,
    trackingNumbers: labels.map((l) => l.trackingNumber),
    keysUpdated: keys,
    errors,
    walletPreflight,
    recoveredCandidates,
  });
}
