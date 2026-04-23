/**
 * POST /api/ops/amazon/reship
 *
 * Void existing ShipStation labels for the given Amazon FBM orderNumbers
 * and re-buy new labels with the current `getShipFromAddress()` defaults.
 * Used when a batch of labels was bought under stale ship-from settings
 * (wrong name, wrong return address, wrong origin ZIP).
 *
 * Per order, the sequence is:
 *   1. Lookup ShipStation order by orderNumber (need orderId + shipTo
 *      for the restore step).
 *   2. List outstanding (non-voided) shipments on that order.
 *   3. Void each outstanding shipment (refunds to the carrier wallet).
 *   4. Restore the order to `awaiting_shipment` status via
 *      /orders/createorder (so Seller Central's shipped-state doesn't
 *      block our re-create).
 *   5. Re-run the same label-buy + mark-shipped path the `ship-now`
 *      route uses. The mark-shipped call pushes the NEW tracking to
 *      Amazon via ShipStation's sales-channel sync.
 *
 * If any step fails mid-way, the response lists which orders succeeded
 * and which didn't. Ben can re-call with just the failed subset.
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
import { fetchOrderItems, isAmazonConfigured } from "@/lib/amazon/sp-api";
import {
  createLabelForShipStationOrder,
  findShipmentsByOrderNumber,
  findShipStationOrderByNumber,
  isShipStationConfigured,
  restoreOrderToAwaitingShipment,
  voidShipStationLabel,
  type ShipStationOrderSummary,
} from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_DISPATCHED = "amazon:fbm:dispatched";

interface DispatchedEntry {
  orderId: string;
  dispatchedAt: string;
  trackingNumber?: string | null;
}

interface ReshipBody {
  orderNumbers: string[];
  /** Override service/carrier for the re-ship (rare). */
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  /** Don't execute anything — return plan only. */
  dryRun?: boolean;
}

interface ReshipStep {
  ts: string;
  step: string;
  ok: boolean;
  detail?: unknown;
  durationMs?: number;
}

interface ReshipResult {
  orderNumber: string;
  ok: boolean;
  voided: Array<{ shipmentId: number; trackingNumber: string | null; refund?: string }>;
  newTrackingNumber?: string;
  newLabelUrl?: string;
  newCost?: number;
  newService?: string;
  error?: string;
  steps: ReshipStep[];
}

function pickServiceFor(units: number): {
  carrierCode: string;
  serviceCode: string;
  packageCode: string;
  weightOunces: number;
  weightLbs: number;
} {
  const weightLbs = 0.05 + 0.5 * Math.max(1, units);
  const weightOunces = Math.round(weightLbs * 16 * 10) / 10;
  const serviceCode =
    weightOunces <= 13 ? "usps_first_class_mail" : "usps_ground_advantage";
  return {
    carrierCode: "stamps_com",
    serviceCode,
    packageCode: "package",
    weightOunces,
    weightLbs: Math.round(weightLbs * 100) / 100,
  };
}

async function logStep(
  steps: ReshipStep[],
  orderNumber: string,
  step: string,
  ok: boolean,
  detail?: unknown,
  startedAt?: number,
): Promise<void> {
  const entry: ReshipStep = {
    ts: new Date().toISOString(),
    step,
    ok,
    detail,
    durationMs: startedAt ? Date.now() - startedAt : undefined,
  };
  steps.push(entry);
  try {
    const run = newRunContext({
      agentId: "amazon-reship",
      division: "production-supply-chain",
      source: "event",
      trigger: `amazon:reship:${step}`,
    });
    const auditEntry = buildAuditEntry(run, {
      action: `amazon.reship.${step}`,
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
      /* best effort */
    }
  } catch (err) {
    console.error(
      "[amazon-reship] audit append failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function reshipOne(
  orderNumber: string,
  opts: Required<Pick<ReshipBody, "dryRun">> &
    Pick<ReshipBody, "carrierCode" | "serviceCode" | "packageCode">,
): Promise<ReshipResult> {
  const steps: ReshipStep[] = [];
  const voided: ReshipResult["voided"] = [];
  let t0 = Date.now();

  // 1. Find the ShipStation order (status may be 'shipped' from last buy)
  const found = await findShipStationOrderByNumber(orderNumber, { status: "shipped" })
    .then((r) => (r.ok && r.order ? r : null))
    .catch(() => null);
  let ssOrder: ShipStationOrderSummary | null = found?.order ?? null;
  if (!ssOrder) {
    // Fall back to awaiting_shipment if the previous buy hadn't marked it
    const retry = await findShipStationOrderByNumber(orderNumber, {
      status: "awaiting_shipment",
    }).catch(() => null);
    ssOrder = retry?.ok ? (retry.order ?? null) : null;
  }
  if (!ssOrder) {
    await logStep(steps, orderNumber, "shipstation.find-order", false, {
      note: "order not found in shipped or awaiting_shipment",
    });
    return {
      orderNumber,
      ok: false,
      voided,
      error: "ShipStation order not found",
      steps,
    };
  }
  await logStep(
    steps,
    orderNumber,
    "shipstation.find-order",
    true,
    { orderId: ssOrder.orderId, status: ssOrder.orderStatus },
    t0,
  );

  // 2. Find outstanding (non-voided) shipments (prefer orderId over orderNumber
  //    — the integer filter is more reliable against ShipStation's /shipments).
  t0 = Date.now();
  const shipmentsRes = await findShipmentsByOrderNumber(orderNumber, {
    orderId: ssOrder.orderId,
  });
  if (!shipmentsRes.ok) {
    await logStep(steps, orderNumber, "shipstation.find-shipments", false, {
      error: shipmentsRes.error,
    });
    return {
      orderNumber,
      ok: false,
      voided,
      error: `Shipment lookup failed: ${shipmentsRes.error}`,
      steps,
    };
  }
  await logStep(
    steps,
    orderNumber,
    "shipstation.find-shipments",
    true,
    {
      count: shipmentsRes.shipments.length,
      ids: shipmentsRes.shipments.map((s) => s.shipmentId),
    },
    t0,
  );

  if (opts.dryRun) {
    await logStep(steps, orderNumber, "dryRun", true, {
      wouldVoidShipments: shipmentsRes.shipments.length,
    });
    return {
      orderNumber,
      ok: true,
      voided,
      steps,
    };
  }

  // 3. Void each shipment
  for (const s of shipmentsRes.shipments) {
    t0 = Date.now();
    const voidRes = await voidShipStationLabel(s.shipmentId);
    if (!voidRes.ok) {
      await logStep(
        steps,
        orderNumber,
        `shipstation.void.${s.shipmentId}`,
        false,
        { error: voidRes.error, tracking: s.trackingNumber },
        t0,
      );
      return {
        orderNumber,
        ok: false,
        voided,
        error: `Void failed for shipment ${s.shipmentId}: ${voidRes.error}`,
        steps,
      };
    }
    voided.push({
      shipmentId: s.shipmentId,
      trackingNumber: s.trackingNumber,
      refund: voidRes.message,
    });
    await logStep(
      steps,
      orderNumber,
      `shipstation.void.${s.shipmentId}`,
      true,
      { tracking: s.trackingNumber, message: voidRes.message },
      t0,
    );
  }

  // 4. Restore order to awaiting_shipment (so re-buy + mark-shipped work clean)
  t0 = Date.now();
  const restoreRes = await restoreOrderToAwaitingShipment(ssOrder);
  if (!restoreRes.ok) {
    await logStep(steps, orderNumber, "shipstation.restore-order", false, {
      error: restoreRes.error,
    });
    // non-fatal — continue (re-buy may still work)
  } else {
    await logStep(steps, orderNumber, "shipstation.restore-order", true, null, t0);
  }

  // 5. Re-buy: enrich with SP-API units, pick service, create label, mark shipped
  t0 = Date.now();
  let units = 0;
  try {
    const items = await fetchOrderItems(orderNumber);
    for (const it of items) units += it.QuantityOrdered ?? 0;
    await logStep(steps, orderNumber, "sp-api.fetch-items", true, { units }, t0);
  } catch (err) {
    await logStep(steps, orderNumber, "sp-api.fetch-items", false, {
      error: err instanceof Error ? err.message : String(err),
    });
    units = Math.max(1, units);
  }
  const plan = pickServiceFor(Math.max(1, units || 1));
  const carrier = opts.carrierCode ?? plan.carrierCode;
  const service = opts.serviceCode ?? plan.serviceCode;
  const pkg = opts.packageCode ?? plan.packageCode;
  await logStep(steps, orderNumber, "plan", true, {
    units,
    weightOunces: plan.weightOunces,
    carrier,
    service,
    package: pkg,
  });

  t0 = Date.now();
  const labelRes = await createLabelForShipStationOrder({
    orderId: ssOrder.orderId,
    orderNumber,
    shipTo: {
      name: ssOrder.shipTo.name ?? "",
      company: ssOrder.shipTo.company ?? undefined,
      street1: ssOrder.shipTo.street1 ?? "",
      street2: ssOrder.shipTo.street2 ?? undefined,
      city: ssOrder.shipTo.city ?? "",
      state: ssOrder.shipTo.state ?? "",
      postalCode: ssOrder.shipTo.postalCode ?? "",
      country: ssOrder.shipTo.country ?? "US",
      phone: ssOrder.shipTo.phone ?? undefined,
      residential: ssOrder.shipTo.residential ?? true,
    },
    carrierCode: carrier,
    serviceCode: service,
    packageCode: pkg,
    confirmation: "delivery",
    weight: { value: plan.weightOunces, units: "ounces" },
    notifyCustomer: false,
    notifySalesChannel: true,
  });
  if (!labelRes.ok) {
    await logStep(steps, orderNumber, "shipstation.create-label", false, {
      error: labelRes.error,
    });
    return {
      orderNumber,
      ok: false,
      voided,
      error: `Re-buy failed: ${labelRes.error}`,
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
      markShippedOk: labelRes.markShippedOk,
      markShippedError: labelRes.markShippedError,
    },
    t0,
  );

  // 6. Update dispatched KV
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
    voided,
    newTrackingNumber: labelRes.label.trackingNumber,
    newLabelUrl: labelRes.label.labelUrl,
    newCost: labelRes.label.cost,
    newService: labelRes.label.service,
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

  let body: ReshipBody;
  try {
    body = (await req.json()) as ReshipBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.orderNumbers) || body.orderNumbers.length === 0) {
    return NextResponse.json(
      { error: "orderNumbers (non-empty array) required" },
      { status: 400 },
    );
  }

  const results: ReshipResult[] = [];
  for (const on of body.orderNumbers) {
    const r = await reshipOne(on, {
      dryRun: body.dryRun === true,
      carrierCode: body.carrierCode,
      serviceCode: body.serviceCode,
      packageCode: body.packageCode,
    });
    results.push(r);
  }

  const shipped = results.filter((r) => r.ok && r.newTrackingNumber).length;
  const failed = results.filter((r) => !r.ok).length;
  const totalNewCost =
    Math.round(
      results.reduce((s, r) => s + (r.newCost ?? 0), 0) * 100,
    ) / 100;
  const totalVoidedCount = results.reduce((s, r) => s + r.voided.length, 0);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    count: body.orderNumbers.length,
    shipped,
    failed,
    totalNewCost,
    totalVoidedCount,
    results,
    summary: results.map((r) => {
      if (r.ok && r.newTrackingNumber) {
        const voidedNote = r.voided.length
          ? ` (voided ${r.voided.map((v) => v.trackingNumber).join(", ")})`
          : "";
        return `✅ ${r.orderNumber} — ${r.newService} — new tracking ${r.newTrackingNumber} — $${(r.newCost ?? 0).toFixed(2)}${voidedNote}`;
      }
      return `❌ ${r.orderNumber} — ${r.error}`;
    }),
  });
}
