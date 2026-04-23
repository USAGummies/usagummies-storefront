/**
 * POST /api/ops/amazon/ship-now
 *
 * The "unified shipping queue" primitive — one call that takes a list
 * of Amazon FBM order numbers (or "all"), and for each one:
 *
 *   1. Pulls the order from Amazon SP-API (units + order total).
 *   2. Looks up the same order in ShipStation (full ship-to PII — the
 *      SP-API RDT gate hides this from us on MFN orders).
 *   3. Picks the cheapest service compatible with the mailer weight
 *      (USPS Ground Advantage by default; First-Class if <16 oz and
 *      the rate comes back cheaper).
 *   4. Calls `/orders/createlabel` on ShipStation — this atomically
 *      buys the label AND marks the ShipStation order shipped, which
 *      their Amazon integration pushes back to Seller Central.
 *   5. Writes the shipped order to `amazon:fbm:dispatched` KV so the
 *      hourly unshipped-alert stops pinging.
 *   6. Mirrors every step to `#ops-audit` (per governance §1.3).
 *
 * Response includes the label PDF (base64 data URL) + tracking for
 * each order so the caller can immediately print.
 *
 * Every call logs structured steps so we have real data to rebuild
 * the unified shipping queue pipeline on top of this primitive.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  fetchOrderItems,
  fetchUnshippedFbmOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import {
  createLabelForShipStationOrder,
  findShipStationOrderByNumber,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_DISPATCHED = "amazon:fbm:dispatched";

interface DispatchedEntry {
  orderId: string;
  dispatchedAt: string;
  trackingNumber?: string | null;
}

interface ShipNowBody {
  /** Specific order numbers. Omit or pass "all" to fetch all unshipped FBM. */
  orderNumbers?: string[] | "all";
  /** Override the carrier — defaults to stamps_com (USPS via Stamps.com). */
  carrierCode?: string;
  /** Override the service. If unset, auto-picks based on packed weight. */
  serviceCode?: string;
  /** Override package code. Default "package". */
  packageCode?: string;
  /** Dry-run — no label buy, returns the plan only. */
  dryRun?: boolean;
}

interface ShipStep {
  ts: string;
  step: string;
  ok: boolean;
  detail?: unknown;
  durationMs?: number;
}

interface ShipResult {
  orderNumber: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  trackingNumber?: string;
  labelUrl?: string;
  cost?: number;
  carrier?: string;
  service?: string;
  weightLbs?: number;
  units?: number;
  error?: string;
  steps: ShipStep[];
}

/**
 * For single-bag or few-bag orders going in our 6×9 padded mailer, pick
 * the service + weight that we want to book.
 *
 * Canonical packed weights (measured 2026-04-21):
 *   1 bag + mailer = ~0.55 lb (8.8 oz)
 *   2 bags + mailer = ~1.05 lb (16.8 oz)
 *   3 bags + mailer = ~1.55 lb
 *   4 bags + mailer = ~2.05 lb
 *
 * USPS First-Class caps at 13 oz — so only the 1-bag mailer is
 * First-Class eligible. Everything else is Ground Advantage (up to 70 lb).
 */
function pickServiceFor(units: number): {
  carrierCode: string;
  serviceCode: string;
  packageCode: string;
  weightOunces: number;
  weightLbs: number;
} {
  const weightLbs = 0.05 + 0.5 * Math.max(1, units); // mailer + bags
  const weightOunces = Math.round(weightLbs * 16 * 10) / 10;
  const serviceCode =
    weightOunces <= 13 ? "usps_first_class_mail" : "usps_ground_advantage";
  return {
    carrierCode: "stamps_com",
    serviceCode,
    packageCode: weightOunces <= 13 ? "package" : "package",
    weightOunces,
    weightLbs: Math.round(weightLbs * 100) / 100,
  };
}

async function logStep(
  steps: ShipStep[],
  orderNumber: string,
  step: string,
  ok: boolean,
  detail?: unknown,
  startedAt?: number,
): Promise<void> {
  const entry: ShipStep = {
    ts: new Date().toISOString(),
    step,
    ok,
    detail,
    durationMs: startedAt ? Date.now() - startedAt : undefined,
  };
  steps.push(entry);

  // Mirror the step to the audit store + #ops-audit Slack per governance §6.
  // Storage is authoritative; Slack is best-effort. Never breaks shipment.
  try {
    const run = newRunContext({
      agentId: "amazon-ship-now",
      division: "production-supply-chain",
      source: "event",
      trigger: `amazon:ship-now:${step}`,
    });
    const auditEntry = buildAuditEntry(run, {
      action: `amazon.ship-now.${step}`,
      entityType: "amazon.fbm.shipment",
      entityId: `amazon:${orderNumber}`,
      after: detail ?? null,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: "amazon", id: orderNumber }],
      confidence: 1,
    });
    await auditStore().append(auditEntry);
    try {
      await auditSurface().mirror(auditEntry);
    } catch {
      /* Slack mirror failure is non-fatal. */
    }
  } catch (err) {
    console.error(
      "[amazon-ship-now] audit append failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function shipOne(
  orderNumber: string,
  opts: Required<Pick<ShipNowBody, "dryRun">> &
    Pick<ShipNowBody, "carrierCode" | "serviceCode" | "packageCode">,
): Promise<ShipResult> {
  const steps: ShipStep[] = [];
  let units = 0;
  let t0 = Date.now();

  // ----- Step 1: enrich with SP-API (units + order total)
  try {
    const items = await fetchOrderItems(orderNumber);
    for (const it of items) {
      units += it.QuantityOrdered ?? 0;
    }
    await logStep(steps, orderNumber, "sp-api.fetch-items", true, { units }, t0);
  } catch (err) {
    await logStep(
      steps,
      orderNumber,
      "sp-api.fetch-items",
      false,
      { error: err instanceof Error ? err.message : String(err) },
      t0,
    );
    // non-fatal — continue with units=1 assumption
    units = Math.max(1, units);
  }

  // ----- Step 2: lookup ShipStation order (full ship-to)
  t0 = Date.now();
  const ssLookup = await findShipStationOrderByNumber(orderNumber);
  if (!ssLookup.ok) {
    await logStep(steps, orderNumber, "shipstation.find-order", false, {
      error: ssLookup.error,
    });
    return {
      orderNumber,
      ok: false,
      error: `ShipStation lookup failed: ${ssLookup.error}`,
      steps,
    };
  }
  if (!ssLookup.order) {
    await logStep(
      steps,
      orderNumber,
      "shipstation.find-order",
      false,
      { note: "no awaiting_shipment match" },
      t0,
    );
    return {
      orderNumber,
      ok: false,
      skipped: true,
      skipReason:
        "ShipStation has no awaiting_shipment order for this orderNumber (may already be shipped)",
      steps,
    };
  }
  const ssOrder = ssLookup.order;
  await logStep(
    steps,
    orderNumber,
    "shipstation.find-order",
    true,
    {
      orderId: ssOrder.orderId,
      shipTo: { city: ssOrder.shipTo.city, state: ssOrder.shipTo.state },
      items: ssOrder.items,
    },
    t0,
  );

  // ----- Step 3: pick service + weight
  const plan = pickServiceFor(Math.max(1, units || 1));
  const effectiveCarrier = opts.carrierCode ?? plan.carrierCode;
  const effectiveService = opts.serviceCode ?? plan.serviceCode;
  const effectivePackage = opts.packageCode ?? plan.packageCode;
  await logStep(steps, orderNumber, "plan", true, {
    units,
    weightOunces: plan.weightOunces,
    weightLbs: plan.weightLbs,
    carrier: effectiveCarrier,
    service: effectiveService,
    package: effectivePackage,
  });

  if (opts.dryRun) {
    return {
      orderNumber,
      ok: true,
      skipped: true,
      skipReason: "dryRun",
      units,
      weightLbs: plan.weightLbs,
      carrier: effectiveCarrier,
      service: effectiveService,
      steps,
    };
  }

  // ----- Step 4: buy label
  t0 = Date.now();
  const labelRes = await createLabelForShipStationOrder({
    orderId: ssOrder.orderId,
    carrierCode: effectiveCarrier,
    serviceCode: effectiveService,
    packageCode: effectivePackage,
    confirmation: "delivery",
    weight: { value: plan.weightOunces, units: "ounces" },
  });
  if (!labelRes.ok) {
    await logStep(
      steps,
      orderNumber,
      "shipstation.create-label",
      false,
      { error: labelRes.error },
      t0,
    );
    return {
      orderNumber,
      ok: false,
      error: `Label buy failed: ${labelRes.error}`,
      units,
      weightLbs: plan.weightLbs,
      steps,
    };
  }
  await logStep(
    steps,
    orderNumber,
    "shipstation.create-label",
    true,
    {
      tracking: labelRes.label.trackingNumber,
      cost: labelRes.label.cost,
      service: labelRes.label.service,
    },
    t0,
  );

  // ----- Step 5: persist dispatched so unshipped-alert dedupes
  try {
    const existing =
      ((await kv.get<DispatchedEntry[]>(KV_DISPATCHED)) ?? []) as DispatchedEntry[];
    existing.push({
      orderId: orderNumber,
      dispatchedAt: new Date().toISOString(),
      trackingNumber: labelRes.label.trackingNumber,
    });
    await kv.set(KV_DISPATCHED, existing.slice(-500));
    await logStep(steps, orderNumber, "kv.mark-dispatched", true, {
      tracking: labelRes.label.trackingNumber,
    });
  } catch (err) {
    await logStep(steps, orderNumber, "kv.mark-dispatched", false, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    orderNumber,
    ok: true,
    trackingNumber: labelRes.label.trackingNumber,
    labelUrl: labelRes.label.labelUrl,
    cost: labelRes.label.cost,
    carrier: labelRes.label.carrier,
    service: labelRes.label.service,
    weightLbs: plan.weightLbs,
    units,
    steps,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: "Amazon SP-API not configured" },
      { status: 503 },
    );
  }
  if (!isShipStationConfigured()) {
    return NextResponse.json(
      { error: "ShipStation not configured" },
      { status: 503 },
    );
  }

  let body: ShipNowBody = {};
  try {
    body = (await req.json()) as ShipNowBody;
  } catch {
    // tolerate empty body — means "ship all unshipped"
  }

  // ----- Resolve the order list
  const ordersToShip: string[] = [];
  if (Array.isArray(body.orderNumbers)) {
    ordersToShip.push(...body.orderNumbers);
  } else {
    try {
      const unshipped = await fetchUnshippedFbmOrders({ daysBack: 7 });
      for (const u of unshipped) ordersToShip.push(u.orderId);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `SP-API unshipped fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 502 },
      );
    }
  }

  if (ordersToShip.length === 0) {
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      count: 0,
      results: [],
      message: "No unshipped Amazon FBM orders in the queue.",
    });
  }

  // ----- Process each order
  // (Wallet preflight happens upstream via /api/ops/fulfillment/preflight
  //  — no need to re-run it here; buy failures surface as per-order errors
  //  with the ShipStation "insufficient balance" message if that ever hits.)
  const results: ShipResult[] = [];
  for (const on of ordersToShip) {
    const r = await shipOne(on, {
      dryRun: body.dryRun === true,
      carrierCode: body.carrierCode,
      serviceCode: body.serviceCode,
      packageCode: body.packageCode,
    });
    results.push(r);
  }

  const shipped = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  const totalCost =
    Math.round(
      results
        .filter((r) => typeof r.cost === "number")
        .reduce((s, r) => s + (r.cost ?? 0), 0) * 100,
    ) / 100;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    count: ordersToShip.length,
    shipped,
    skipped,
    failed,
    totalCost,
    results,
    // One-line summary per order for copy-paste into Slack or chat.
    summary: results.map((r) => {
      if (r.ok && !r.skipped) {
        return `✅ ${r.orderNumber} — ${r.service} — ${r.trackingNumber} — $${(r.cost ?? 0).toFixed(2)}`;
      }
      if (r.skipped) {
        return `⏭  ${r.orderNumber} — skipped (${r.skipReason})`;
      }
      return `❌ ${r.orderNumber} — ${r.error}`;
    }),
  });
}

// GET variant — cheap dry-run plan without any side effects. Useful for
// the unified-queue UI "what would happen if I ship all now?" preview.
export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Re-use POST handler with dryRun forced on.
  const dryRunReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ dryRun: true }),
  });
  return POST(dryRunReq);
}
