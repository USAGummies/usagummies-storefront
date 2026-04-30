/**
 * Buy a UPS Ground shipping label for one or more items in the fulfillment
 * queue. Part of Phase 2 of the Shipping Hub.
 *
 * POST body:
 *   {
 *     keys: string[],          // e.g. ["inv:1535", "pending:inderbitzin-po-009180-remainder"]
 *     destination: {...},      // ship-to address (mandatory for now — we don't auto-infer)
 *     packagingType: "mailer" | "case" | "master_carton",
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
import { evaluateAtp, type AtpGateResult } from "@/lib/ops/atp-gate";
import { lookupDeliveredPricing } from "@/lib/ops/delivered-pricing-guard";
import {
  advanceDealOnShipment,
  type DealAdvanceResult,
} from "@/lib/ops/hubspot-client";
import {
  buildFreightCompJournalEntry,
  FREIGHT_COMP_CHANNELS,
  type FreightCompChannel,
} from "@/lib/ops/freight-comp";
import {
  KV_INVENTORY_SNAPSHOT,
  decrementSnapshot,
  type InventorySnapshot,
} from "@/lib/ops/inventory-snapshot";
import {
  createShippingLabel,
  findRecentShipmentByAddress,
  getCheapestShipStationRate,
  preflightWalletCheck,
  type LabelDestination,
  type LabelResult,
} from "@/lib/ops/shipstation-client";
import { uploadBufferToSlack } from "@/lib/ops/slack-file-upload";
import type { QBOJournalEntryInput } from "@/lib/ops/qbo-client";

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
const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

/** Pending freight-comp JE entry queued for Rene's Thursday digest. */
interface FreightCompQueueEntry {
  queuedAt: string;
  channel: FreightCompChannel;
  channelLabel: string;
  customerName: string;
  customerMatch: string;
  freightDollars: number;
  trackingNumbers: string[];
  shipmentIds: Array<string | number>;
  customerRef: string;
  journalEntry: QBOJournalEntryInput;
  status: "queued" | "approved" | "posted" | "rejected";
  /** Ben's wallet + total cost bookkeeping for the Thursday digest. */
  buyLoopKeys: string[];
}

/**
 * Classify a delivered-pricing match into a FreightCompChannel code.
 * Aligned with distributor-pricing-commitments.md §2/§3.
 */
function channelFromPricingTier(tier: string): FreightCompChannel {
  if (tier === "show_special_325") return "trade_show";
  if (tier.startsWith("option_") || tier === "sell_sheet_249") return "distributor";
  return "dtc_absorbed";
}

interface BuyLabelRequest {
  keys?: string[];
  destination?: LabelDestination;
  packagingType?: "mailer" | "case" | "master_carton";
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
  /**
   * Escape hatch for the ATP (over-promise) gate. Default true → refuse
   * to buy when projected deficit > blockDeficitThreshold (24 bags).
   * Override with false when Ben knows inventory is short but wants to
   * ship anyway (e.g. Shopify snapshot stale, or a planned backorder).
   */
  allowOverPromise?: boolean;
  /**
   * HubSpot deal to advance on successful label buy. If set, after the
   * label is purchased we PATCH the deal to `STAGE_SHIPPED` and attach
   * a tracking-number note to the deal timeline (best-effort; a
   * HubSpot outage does not fail the label buy).
   */
  hubspotDealId?: string;
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

  // ATP over-promise gate. Prevents buying labels for more bags than
  // Ashford has on-hand + pending. Unknown-snapshot short-circuits to
  // `ok` rather than blocking. See `src/lib/ops/atp-gate.ts`.
  const inventorySnapshot =
    ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
      null) as InventorySnapshot | null;
  const atpResult: AtpGateResult = evaluateAtp({
    snapshot: inventorySnapshot,
    stages,
    excludeKeys: keys,
    newCartons: cartonCount,
    newPackagingType: packagingType,
  });
  const allowOverPromise = body.allowOverPromise === true;
  if (atpResult.risk === "block" && !allowOverPromise) {
    return NextResponse.json(
      {
        ok: false,
        error: `ATP over-promise block: ${atpResult.reason}`,
        atpGate: atpResult,
        pickedCarrier: carrierCode,
        ratePreview,
      },
      { status: 409 },
    );
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
      atpGate: atpResult,
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

  // Inventory snapshot auto-decrement. Keeps the cached snapshot
  // honest after a ship without waiting for the 10:00 PT Ops Agent
  // refresh. Uses the BAGS_PER_CARTON constants via the ATP module's
  // conventions: master_carton=36, case=6. Best-effort — snapshot
  // miss doesn't fail the buy.
  const BAGS_PER_CARTON_LOCAL: Record<"mailer" | "case" | "master_carton", number> = {
    mailer: 1,
    case: 6,
    master_carton: 36,
  };
  const shippedBags = labels.length * (BAGS_PER_CARTON_LOCAL[packagingType] ?? 36);
  if (inventorySnapshot && shippedBags > 0) {
    try {
      const decremented = decrementSnapshot(inventorySnapshot, shippedBags);
      if (decremented) {
        await kv.set(KV_INVENTORY_SNAPSHOT, decremented);
      }
    } catch {
      // Best-effort — drift self-heals tomorrow.
    }
  }

  // BUILD #6 — CF-09 freight-comp auto-queue.
  // If the destination matches a delivered-pricing customer, auto-build
  // the paired DEBIT 500050 / CREDIT 499010 QBO JournalEntry and park
  // it in KV. Finance Exception Agent surfaces the queue in Rene's
  // Thursday digest for one-click posting (Class B approval). Doctrine:
  // /contracts/distributor-pricing-commitments.md §5.
  let freightCompQueued: FreightCompQueueEntry | null = null;
  const pricingMatch = lookupDeliveredPricing(body.destination.name);
  if (pricingMatch && totalCost > 0) {
    const channel = channelFromPricingTier(pricingMatch.tier);
    const trackingNumbers = labels
      .map((l) => l.trackingNumber)
      .filter((t): t is string => Boolean(t));
    const shipmentIds = labels
      .map((l) => l.shipmentId)
      .filter((id): id is number => id !== null);
    const customerRef = keys.join("+");
    const journalEntry = buildFreightCompJournalEntry({
      freightCostDollars: totalCost,
      channel,
      shipmentId: shipmentIds[0] ?? "unknown",
      trackingNumber: trackingNumbers.join(", "),
      customerRef,
    });
    freightCompQueued = {
      queuedAt: now,
      channel,
      channelLabel: FREIGHT_COMP_CHANNELS[channel].label,
      customerName: body.destination.name,
      customerMatch: pricingMatch.match,
      freightDollars: Math.round(totalCost * 100) / 100,
      trackingNumbers,
      shipmentIds,
      customerRef,
      journalEntry,
      status: "queued",
      buyLoopKeys: keys,
    };
    const queue =
      ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
        []) as FreightCompQueueEntry[];
    queue.unshift(freightCompQueued);
    // Cap at 500 entries so KV doesn't unbounded-grow.
    const trimmed = queue.slice(0, 500);
    await kv.set(KV_FREIGHT_COMP_QUEUE, trimmed);
  }

  // HubSpot deal-stage auto-advance. When the caller supplies a
  // `hubspotDealId`, we patch the deal to `STAGE_SHIPPED` + attach a
  // note with tracking numbers. Best-effort — failures don't break
  // the label buy response.
  let hubspotAdvance: DealAdvanceResult | null = null;
  if (body.hubspotDealId) {
    try {
      const firstLabel = labels[0];
      hubspotAdvance = await advanceDealOnShipment({
        dealId: body.hubspotDealId,
        trackingNumbers: labels
          .map((l) => l.trackingNumber)
          .filter((t): t is string => Boolean(t)),
        carrier: firstLabel?.carrier,
        service: firstLabel?.service,
        labelCostTotal: Math.round(totalCost * 100) / 100,
        memo: `Keys: ${keys.join(", ")}${pricingMatch ? ` · ${pricingMatch.terms}` : ""}`,
      });
    } catch (err) {
      hubspotAdvance = {
        ok: false,
        dealId: body.hubspotDealId,
        stageUpdated: false,
        newStage: null,
        noteId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    purchased: labels.length,
    totalCost: Math.round(totalCost * 100) / 100,
    labels,
    trackingNumbers: labels.map((l) => l.trackingNumber),
    keysUpdated: keys,
    errors,
    walletPreflight,
    atpGate: atpResult,
    recoveredCandidates,
    // BUILD #6 + #7 wiring surface — caller can see exactly what was
    // queued for Rene. `pricingDoctrineMatch` is null when the customer
    // isn't on delivered pricing (the default path).
    pricingDoctrineMatch: pricingMatch
      ? {
          customerName: body.destination.name,
          match: pricingMatch.match,
          tier: pricingMatch.tier,
          terms: pricingMatch.terms,
          freightAbsorbed: pricingMatch.freightAbsorbed,
          source: pricingMatch.source,
        }
      : null,
    freightCompQueued,
    hubspotAdvance,
  });
}
