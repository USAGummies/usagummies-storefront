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
  // Inner case: 6 bags 7.5 oz + inserts. ~6 lb packed (weighed 2026-04-20).
  case: { length: 14, width: 10, height: 8, weightLbs: 6 },
  // Master carton: 6 cases × 6 bags = 36 bags 7.5 oz. Packed weight
  // measured 2026-04-20 by Ben = 21 lb 2 oz = 21.125 lb. Canonical for
  // all future shipments until a SKU or case-pack change is logged.
  master_carton: { length: 21, width: 14, height: 8, weightLbs: 21.125 },
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
// Carrier-agnostic rate shopping
// ---------------------------------------------------------------------------
//
// Ben's ShipStation trial has USPS connected but not UPS. The legacy
// `getUpsGroundRate` above hardcodes UPS and fails when UPS isn't
// connected. This helper instead lists connected carriers via
// `/carriers`, rate-quotes against each, and returns the cheapest.
//
// Scope: parcel services only. Pallet orders short-circuit to LTL
// (priced landed; not quoted here). Returns null if no carriers are
// connected — the caller surfaces that as a clean unavailable.

export interface CarrierInfo {
  name: string;
  code: string;
  requiresFundedAccount?: boolean;
  primary?: boolean;
}

export async function listShipStationCarriers(): Promise<
  { ok: true; carriers: CarrierInfo[] } | { ok: false; error: string }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };
  try {
    const res = await fetch("https://ssapi.shipstation.com/carriers", {
      headers: { Authorization: auth, Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `ShipStation ${res.status}: ${text.slice(0, 200)}` };
    }
    const raw = (await res.json()) as Array<{
      Name?: string;
      Code?: string;
      RequiresFundedAccount?: boolean;
      Primary?: boolean;
    }>;
    const carriers = raw.map(
      (c): CarrierInfo => ({
        name: c.Name ?? "",
        code: String(c.Code ?? ""),
        requiresFundedAccount: Boolean(c.RequiresFundedAccount),
        primary: Boolean(c.Primary),
      }),
    );
    return { ok: true, carriers };
  } catch (err) {
    return {
      ok: false,
      error: `ShipStation /carriers threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface CheapestRateQuote {
  provider: "shipstation";
  carrier: string;
  carrierCode: string;
  service: string;
  serviceCode: string;
  rate: number;
  deliveryDays: number | null;
  /** Per-package rate; multiply by quantity for multi-package orders. */
  perPackage: number;
}

/**
 * Rate-shop across every connected ShipStation carrier and return the
 * cheapest parcel service for the given destination + packaging.
 *
 * Multi-package orders quote one package then multiply by qty — UPS
 * Ground + USPS Ground Advantage both scale linearly at our weights,
 * so this is close enough for the fulfillment hub's "which carrier
 * wins" call. Actual buy-time rate may differ by pennies.
 */
export async function getCheapestShipStationRate(params: {
  toZip: string;
  toState: string;
  packagingType: Exclude<ShippingPackageType, "pallet">;
  quantity: number;
  residential?: boolean;
  weightOverrideLbs?: number;
}): Promise<{ ok: true; quote: CheapestRateQuote } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const carriersRes = await listShipStationCarriers();
  if (!carriersRes.ok) return carriersRes;

  const profile = PACKAGE_PROFILES[params.packagingType];
  const weightLbs = params.weightOverrideLbs ?? profile.weightLbs;

  const baseBody = {
    packageCode: "package",
    fromPostalCode: BOOTH_ORIGIN_ZIP,
    toState: params.toState.trim().toUpperCase(),
    toCountry: "US",
    toPostalCode: params.toZip.trim(),
    weight: { value: weightLbs, units: "pounds" },
    dimensions: {
      units: "inches",
      length: profile.length,
      width: profile.width,
      height: profile.height,
    },
    confirmation: "delivery",
    residential: params.residential ?? false,
  };

  // Fetch rates across every connected carrier in parallel.
  const rateResults = await Promise.all(
    carriersRes.carriers.map(async (c) => {
      try {
        const res = await fetch("https://ssapi.shipstation.com/shipments/getrates", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ ...baseBody, carrierCode: c.code }),
        });
        if (!res.ok) return { carrier: c, rates: [] as ShipStationRate[] };
        const rates = (await res.json()) as ShipStationRate[];
        return { carrier: c, rates };
      } catch {
        return { carrier: c, rates: [] as ShipStationRate[] };
      }
    }),
  );

  // Flatten + exclude any zero/unreasonable rates.
  const candidates: CheapestRateQuote[] = [];
  for (const { carrier, rates } of rateResults) {
    for (const r of rates) {
      const perPackage = (r.shipmentCost ?? 0) + (r.otherCost ?? 0);
      if (!Number.isFinite(perPackage) || perPackage <= 0) continue;
      candidates.push({
        provider: "shipstation",
        carrier: carrier.name,
        carrierCode: carrier.code,
        service: r.serviceName,
        serviceCode: r.serviceCode,
        rate: Math.round(perPackage * Math.max(1, params.quantity) * 100) / 100,
        deliveryDays: r.transitDays ?? null,
        perPackage: Math.round(perPackage * 100) / 100,
      });
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      error: "No rates returned from any connected ShipStation carrier",
    };
  }

  // Sort by total rate, return cheapest.
  candidates.sort((a, b) => a.rate - b.rate);
  return { ok: true, quote: candidates[0] };
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
 * Buy a shipping label for one package via ShipStation.
 *
 * `carrierCode` + `serviceCode` default to UPS Ground for backward
 * compatibility with the legacy booth flow. The fulfillment hub's
 * Phase-2 buy-label path passes the winner from
 * `getCheapestShipStationRate()` so the actual carrier/service used
 * varies per destination (USPS for light / AK, UPS Ground for heavy
 * cross-country, etc.).
 *
 * Ship-from is USA Gummies / Ashford WA (see env-driven getShipFromAddress).
 * Parcel dimensions come from PACKAGE_PROFILES unless overridden. The method
 * hits ShipStation's `/shipments/createlabel` which atomically rates + buys
 * + returns a tracking number.
 */
export async function createShippingLabel(params: {
  destination: LabelDestination;
  packagingType: Exclude<ShippingPackageType, "pallet">;
  /** Defaults to UPS Ground; pass the winning carrier/service from rate-shop. */
  carrierCode?: string;
  serviceCode?: string;
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
    carrierCode: params.carrierCode ?? "ups",
    serviceCode: params.serviceCode ?? "ups_ground",
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

  const carrierUsed = data.carrierCode ?? params.carrierCode ?? "ups";
  const serviceUsed = data.serviceCode ?? params.serviceCode ?? "ups_ground";
  return {
    ok: true,
    label: {
      carrier: carrierUsed.toUpperCase(),
      service: humanizeService(serviceUsed),
      serviceCode: serviceUsed,
      trackingNumber: tracking,
      labelUrl,
      cost: Math.round(cost * 100) / 100,
      shipmentId: data.shipmentId ?? null,
    },
  };
}

function humanizeService(code: string): string {
  const map: Record<string, string> = {
    ups_ground: "UPS® Ground",
    usps_ground_advantage: "USPS Ground Advantage",
    usps_priority_mail: "USPS Priority Mail",
    usps_first_class_mail: "USPS First-Class",
    usps_parcel_select_ground: "USPS Parcel Select",
    fedex_ground: "FedEx Ground",
    fedex_home_delivery: "FedEx Home Delivery",
  };
  return map[code] ?? code;
}

/**
 * Backwards-compat shim: old callers that hardcoded UPS Ground.
 * Prefer `createShippingLabel` + pass the winner from rate-shop.
 */
export async function createUpsGroundLabel(
  params: Omit<Parameters<typeof createShippingLabel>[0], "carrierCode" | "serviceCode">,
): Promise<{ ok: true; label: LabelResult } | { ok: false; error: string }> {
  return createShippingLabel({ ...params, carrierCode: "ups", serviceCode: "ups_ground" });
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
