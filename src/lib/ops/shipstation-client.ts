/**
 * ShipStation Client — USA Gummies
 *
 * - `getUpsGroundRate` — live UPS Ground quotes for the booth / quick-order flow.
 * - `createUpsGroundLabel` — buy and print a UPS Ground label for the shipping hub
 *   fulfillment queue (phase 2). Returns tracking # + label PDF URL.
 *
 * Auth: HTTP Basic with `SHIPSTATION_API_KEY:SHIPSTATION_API_SECRET`.
 * Docs: https://www.shipstation.com/docs/api/
 */
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Origin + package specs (Ashford, WA warehouse → wholesale buyer)
// ---------------------------------------------------------------------------

export const BOOTH_ORIGIN_ZIP = "98304"; // Mettler warehouse, Ashford WA

// Ship-from address for label purchases. Matches the origin ZIP above; the
// rest of the fields are populated from env so Ben can tighten without a deploy.
// Values are trimmed at read-time in getShipFromAddress() — trailing `\n`
// corruption in Vercel env would otherwise silently break label auth.
export interface ShipFromAddress {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

function getShipFromAddress(): ShipFromAddress {
  return {
    name: process.env.SHIPSTATION_FROM_NAME?.trim() || "Benjamin Stutman",
    company: process.env.SHIPSTATION_FROM_COMPANY?.trim() || "USA Gummies",
    street1: process.env.SHIPSTATION_FROM_STREET1?.trim() || "30027 SR 706 E",
    street2: process.env.SHIPSTATION_FROM_STREET2?.trim() || undefined,
    city: process.env.SHIPSTATION_FROM_CITY?.trim() || "Ashford",
    state: process.env.SHIPSTATION_FROM_STATE?.trim() || "WA",
    postalCode: process.env.SHIPSTATION_FROM_POSTALCODE?.trim() || BOOTH_ORIGIN_ZIP,
    country: process.env.SHIPSTATION_FROM_COUNTRY?.trim() || "US",
    phone: process.env.SHIPSTATION_FROM_PHONE?.trim() || "3072094928",
  };
}

export type ShippingPackageType = "case" | "master_carton" | "pallet";

// The quick-order flow needs workable shipping estimates for one-off case and
// master-case sales. Pallets are priced landed, so they skip parcel quoting
// and return a zero-dollar included-freight line instead.
const PACKAGE_PROFILES: Record<
  Exclude<ShippingPackageType, "pallet">,
  {
    length: number;
    width: number;
    height: number;
    weightLbs: number;
  }
> = {
  case: { length: 14, width: 10, height: 8, weightLbs: 6 },
  master_carton: { length: 21, width: 14, height: 8, weightLbs: 24 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreightQuote = {
  carrier: string; // "UPS"
  service: string; // "UPS® Ground"
  service_code: string; // "ups_ground"
  rate: number; // dollars
  delivery_days: number | null;
};

type ShipStationRate = {
  serviceName: string;
  serviceCode: string;
  shipmentCost: number;
  otherCost: number;
  transitDays?: number | null;
};

// ---------------------------------------------------------------------------
// Auth + config
// ---------------------------------------------------------------------------

function getAuthHeader(): string | null {
  const key = process.env.SHIPSTATION_API_KEY?.trim();
  const secret = process.env.SHIPSTATION_API_SECRET?.trim();
  if (!key || !secret) return null;
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

export function isShipStationConfigured(): boolean {
  return getAuthHeader() !== null;
}

// ---------------------------------------------------------------------------
// Rate quote
// ---------------------------------------------------------------------------

export async function getUpsGroundRate(params: {
  toZip: string;
  toState: string;
  packagingType: ShippingPackageType;
  quantity: number;
  residential?: boolean;
}): Promise<{ ok: true; quote: FreightQuote } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) {
    return { ok: false, error: "ShipStation credentials not configured" };
  }

  const qty = Math.max(1, Math.floor(params.quantity));
  if (!/^\d{5}(-\d{4})?$/.test(params.toZip.trim())) {
    return { ok: false, error: "Invalid ZIP code" };
  }
  if (!/^[A-Z]{2}$/.test(params.toState.trim().toUpperCase())) {
    return { ok: false, error: "Invalid state code" };
  }
  if (params.packagingType === "pallet") {
    return {
      ok: true,
      quote: {
        carrier: "LTL",
        service: "LTL freight included",
        service_code: "ltl_included",
        rate: 0,
        delivery_days: null,
      },
    };
  }
  const profile = PACKAGE_PROFILES[params.packagingType];
  if (!profile) {
    return { ok: false, error: "Invalid packaging type" };
  }

  // ShipStation rates a single package per call. For multi-package orders we
  // quote one package and multiply. UPS Ground scales closely enough for
  // identical case/master-case packages, which is sufficient for the quick
  // order flow.
  const body = {
    carrierCode: "ups",
    serviceCode: "ups_ground",
    packageCode: "package",
    fromPostalCode: BOOTH_ORIGIN_ZIP,
    toState: params.toState.trim().toUpperCase(),
    toCountry: "US",
    toPostalCode: params.toZip.trim(),
    weight: { value: profile.weightLbs, units: "pounds" },
    dimensions: {
      units: "inches",
      length: profile.length,
      width: profile.width,
      height: profile.height,
    },
    confirmation: "delivery",
    residential: params.residential ?? false,
  };

  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/shipments/getrates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: `ShipStation request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `ShipStation ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const rates = (await res.json()) as ShipStationRate[];
  const ground = rates.find((r) => r.serviceCode === "ups_ground") ?? rates[0];
  if (!ground) {
    return { ok: false, error: "No UPS Ground rate returned" };
  }

  const perCase = (ground.shipmentCost ?? 0) + (ground.otherCost ?? 0);
  const total = Math.round(perCase * qty * 100) / 100;

  return {
    ok: true,
    quote: {
      carrier: "UPS",
      service: ground.serviceName || "UPS® Ground",
      service_code: ground.serviceCode || "ups_ground",
      rate: total,
      delivery_days: ground.transitDays ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Label purchase (Phase 2 — Shipping Hub)
// ---------------------------------------------------------------------------

export interface LabelDestination {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  phone?: string;
  residential?: boolean;
}

export interface LabelResult {
  carrier: string;
  service: string;
  serviceCode: string;
  trackingNumber: string;
  labelUrl: string; // publicly-accessible PDF URL (ShipStation CDN, signed)
  cost: number;
  shipmentId: number | null;
}

interface ShipStationLabelResponse {
  shipmentId?: number;
  shipmentCost?: number;
  insuranceCost?: number;
  trackingNumber?: string;
  labelData?: string; // base64-encoded PDF if requested
  formData?: string | null;
  carrierCode?: string;
  serviceCode?: string;
  shipmentItems?: unknown;
}

/**
 * Buy a UPS Ground shipping label for one package.
 *
 * Ship-from is USA Gummies / Ashford WA (see env-driven getShipFromAddress).
 * Parcel dimensions come from PACKAGE_PROFILES unless overridden. The method
 * hits ShipStation's `/shipments/createlabel` which atomically rates + buys
 * + returns a tracking number.
 */
export async function createUpsGroundLabel(params: {
  destination: LabelDestination;
  packagingType: Exclude<ShippingPackageType, "pallet">;
  /** Optional override — useful when multiple master cartons go to one address. */
  weightLbsOverride?: number;
  /** Idempotency — ShipStation uses `orderNumber` as the duplicate-detect key. */
  orderNumber?: string;
  customerNotes?: string;
}): Promise<{ ok: true; label: LabelResult } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  if (!/^\d{5}(-\d{4})?$/.test(params.destination.postalCode.trim())) {
    return { ok: false, error: "Invalid destination ZIP" };
  }
  if (!/^[A-Z]{2}$/.test(params.destination.state.trim().toUpperCase())) {
    return { ok: false, error: "Invalid destination state" };
  }

  const profile = PACKAGE_PROFILES[params.packagingType];
  if (!profile) return { ok: false, error: "Invalid packagingType" };

  const from = getShipFromAddress();
  const weightLbs = params.weightLbsOverride ?? profile.weightLbs;

  const body = {
    carrierCode: "ups",
    serviceCode: "ups_ground",
    packageCode: "package",
    confirmation: "delivery",
    shipDate: new Date().toISOString().slice(0, 10),
    weight: { value: weightLbs, units: "pounds" },
    dimensions: {
      units: "inches",
      length: profile.length,
      width: profile.width,
      height: profile.height,
    },
    shipFrom: {
      name: from.name,
      company: from.company,
      street1: from.street1,
      street2: from.street2,
      city: from.city,
      state: from.state,
      postalCode: from.postalCode,
      country: from.country,
      phone: from.phone,
    },
    shipTo: {
      name: params.destination.name,
      company: params.destination.company,
      street1: params.destination.street1,
      street2: params.destination.street2,
      city: params.destination.city,
      state: params.destination.state.trim().toUpperCase(),
      postalCode: params.destination.postalCode.trim(),
      country: (params.destination.country || "US").trim().toUpperCase(),
      phone: params.destination.phone,
      residential: params.destination.residential ?? false,
    },
    testLabel: false, // real purchases — ShipStation has a separate `testLabel: true` flag for dry runs
    customerNotes: params.customerNotes,
    internalNotes: params.orderNumber,
  };

  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/shipments/createlabel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: `ShipStation request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `ShipStation ${res.status}: ${text.slice(0, 400)}`,
    };
  }

  const data = (await res.json()) as ShipStationLabelResponse;
  const tracking = data.trackingNumber?.trim();
  if (!tracking) {
    return { ok: false, error: "ShipStation returned no tracking number" };
  }

  // `labelData` (base64 PDF) comes back inline; we persist it to a data-URL
  // so the UI can download it without a second call. For larger rollouts
  // swap this for an object-storage URL.
  const labelUrl = data.labelData
    ? `data:application/pdf;base64,${data.labelData}`
    : "";

  const cost =
    (typeof data.shipmentCost === "number" ? data.shipmentCost : 0) +
    (typeof data.insuranceCost === "number" ? data.insuranceCost : 0);

  return {
    ok: true,
    label: {
      carrier: "UPS",
      service: "UPS® Ground",
      serviceCode: data.serviceCode || "ups_ground",
      trackingNumber: tracking,
      labelUrl,
      cost: Math.round(cost * 100) / 100,
      shipmentId: data.shipmentId ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Shipment history (cross-ref for the fulfillment hub auto-clear)
// ---------------------------------------------------------------------------

export interface ShipStationShipment {
  shipmentId: number;
  orderId: number | null;
  orderNumber: string | null;
  createDate: string;
  shipDate: string | null;
  trackingNumber: string | null;
  carrierCode: string | null;
  serviceCode: string | null;
  voided: boolean;
  /** Customer-ship-to name — useful when orderNumber isn't matchable. */
  shipToName: string | null;
  /** Ship-to postal code — used in our fuzzy match. */
  shipToPostalCode: string | null;
}

interface ShipStationShipmentsListResponse {
  shipments?: Array<{
    shipmentId: number;
    orderId?: number;
    orderNumber?: string | null;
    createDate?: string;
    shipDate?: string | null;
    trackingNumber?: string | null;
    carrierCode?: string | null;
    serviceCode?: string | null;
    voided?: boolean;
    shipTo?: { name?: string; postalCode?: string };
  }>;
  total?: number;
  page?: number;
  pages?: number;
}

/**
 * Pull shipment records from ShipStation's v1 API for the auto-clear
 * cross-ref flow (Shipping Hub Phase 2/3). Filters to real outbound
 * shipments only (voided + non-tracking entries excluded at the
 * caller's option via `includeVoided`).
 *
 * Why we pass shipDateStart instead of createDateStart: a ShipStation
 * shipment is "historically interesting" to our hub once it's been
 * handed to the carrier — that's what `shipDate` captures. Orders
 * still in "awaiting shipment" don't help us auto-clear the flag.
 *
 * Returns [] if ShipStation creds are missing or the request fails —
 * callers surface that as a degraded line rather than asserting that
 * "no shipments" means "nothing shipped."
 */
export async function getRecentShipments(opts: {
  /** ISO date (YYYY-MM-DD) or ISO timestamp. Defaults to 30 days back. */
  shipDateStart?: string;
  shipDateEnd?: string;
  includeVoided?: boolean;
  pageSize?: number;
}): Promise<{ ok: true; shipments: ShipStationShipment[] } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const pageSize = Math.max(1, Math.min(500, opts.pageSize ?? 200));
  const start =
    opts.shipDateStart ??
    new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const end = opts.shipDateEnd ?? new Date().toISOString().slice(0, 10);

  const url = new URL("https://ssapi.shipstation.com/shipments");
  url.searchParams.set("shipDateStart", start);
  url.searchParams.set("shipDateEnd", end);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("page", "1");
  url.searchParams.set("sortBy", "ShipDate");
  url.searchParams.set("sortDir", "DESC");
  if (!opts.includeVoided) url.searchParams.set("includeShipmentItems", "false");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: "application/json" },
    });
  } catch (err) {
    return {
      ok: false,
      error: `ShipStation request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `ShipStation ${res.status}: ${text.slice(0, 300)}` };
  }

  const data = (await res.json()) as ShipStationShipmentsListResponse;
  const raws = data.shipments ?? [];
  const shipments: ShipStationShipment[] = raws
    .filter((s) => (opts.includeVoided ? true : !s.voided))
    .map(
      (s): ShipStationShipment => ({
        shipmentId: s.shipmentId,
        orderId: s.orderId ?? null,
        orderNumber: s.orderNumber ?? null,
        createDate: s.createDate ?? "",
        shipDate: s.shipDate ?? null,
        trackingNumber: s.trackingNumber ?? null,
        carrierCode: s.carrierCode ?? null,
        serviceCode: s.serviceCode ?? null,
        voided: Boolean(s.voided),
        shipToName: s.shipTo?.name ?? null,
        shipToPostalCode: s.shipTo?.postalCode ?? null,
      }),
    );

  return { ok: true, shipments };
}

/**
 * Look up shipments by their `orderNumber` field (the one we pass to
 * `createUpsGroundLabel` when buying labels from the fulfillment hub).
 * Returns every shipment whose orderNumber starts with the given
 * prefix — useful when multi-carton labels write
 * `orderNumber = <keys>#<i>/<n>`.
 */
export async function findShipmentsByOrderNumberPrefix(
  prefix: string,
  opts: { daysBack?: number } = {},
): Promise<ShipStationShipment[]> {
  const res = await getRecentShipments({
    shipDateStart: new Date(Date.now() - (opts.daysBack ?? 60) * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10),
  });
  if (!res.ok) return [];
  return res.shipments.filter(
    (s) => s.orderNumber !== null && s.orderNumber.startsWith(prefix),
  );
}
