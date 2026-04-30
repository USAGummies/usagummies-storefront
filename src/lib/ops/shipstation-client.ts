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
  // Mirrors the "USA Gummies HQ" warehouse configured in ShipStation
  // (Settings → Shipping → Ship From Locations). Canonical warehouse for
  // all outbound — Ben fulfills every order from Ashford until Drew has
  // inventory. Name is "USA Gummies" (no personal name — privacy +
  // professionalism); `company` is left unset so the label doesn't stack
  // "USA Gummies / USA Gummies" on two lines.
  //
  // Why mirror the SS warehouse exactly: UI-driven labels use the SS
  // warehouse, API-driven labels (/shipments/createlabel) use these
  // fields. Both must match or the audit will flag a drift. If Ben edits
  // the warehouse in ShipStation, update these defaults in the same PR.
  //
  // Env overrides still win so Vercel env can change without a redeploy.
  return {
    name: process.env.SHIPSTATION_FROM_NAME?.trim() || "USA Gummies",
    company: process.env.SHIPSTATION_FROM_COMPANY?.trim() || undefined,
    street1: process.env.SHIPSTATION_FROM_STREET1?.trim() || "30025 SR 706 E",
    street2: process.env.SHIPSTATION_FROM_STREET2?.trim() || undefined,
    city: process.env.SHIPSTATION_FROM_CITY?.trim() || "Ashford",
    state: process.env.SHIPSTATION_FROM_STATE?.trim() || "WA",
    postalCode: process.env.SHIPSTATION_FROM_POSTALCODE?.trim() || "98304",
    country: process.env.SHIPSTATION_FROM_COUNTRY?.trim() || "US",
    phone: process.env.SHIPSTATION_FROM_PHONE?.trim() || "3073211234",
  };
}

export type ShippingPackageType =
  | "mailer"
  | "case"
  | "master_carton"
  | "pallet";

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
  // Branded mailer — single-bag DTC orders (Shopify + Amazon FBM).
  // 6×9 padded mailer + 1 bag 7.5 oz = ~0.55 lb packed. Starting
  // 2026-04-21 when Amazon FBM begins, this is the default for every
  // 1-bag order. Dimensions fit USPS Ground Advantage w/o surcharge.
  mailer: { length: 9, width: 6, height: 2, weightLbs: 0.55 },
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
// Stores list — channel inference for awaiting-shipment classification
// ---------------------------------------------------------------------------
//
// ShipStation V3's Shopify integration leaves `advancedOptions.source` empty
// on imported orders (only `storeId` is populated), so the auto-ship route's
// `sourceLabelFor` heuristic falls through to "Internal" for Shopify orders
// — wrong tag in `#shipping`. Fix: fetch the V1 `/stores` list once per
// process, build a `storeId → marketplaceName` map, and use it to derive a
// canonical channel string ("amazon" / "shopify" / "faire") even when
// `advancedOptions.source` is null.
//
// In-process cache only (no KV) — V1 stores list is small and stable; a
// per-cold-start refresh is more than enough for cron lifetimes.

export type ShipStationStoreSummary = {
  storeId: number;
  storeName: string | null;
  marketplaceId: number | null;
  marketplaceName: string | null;
  active: boolean;
};

let cachedStores: ShipStationStoreSummary[] | null = null;
let cachedStoresFetchedAt = 0;
const STORES_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

/**
 * Fetch the ShipStation V1 stores list (cached). Returns `[]` on auth
 * failure / network error so callers can fall through to existing
 * heuristics rather than throwing.
 */
export async function listShipStationStores(): Promise<ShipStationStoreSummary[]> {
  if (cachedStores && Date.now() - cachedStoresFetchedAt < STORES_CACHE_TTL_MS) {
    return cachedStores;
  }
  const auth = getAuthHeader();
  if (!auth) return [];
  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/stores", {
      method: "GET",
      headers: { Authorization: auth, Accept: "application/json" },
    });
  } catch {
    return cachedStores ?? [];
  }
  if (!res.ok) return cachedStores ?? [];
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return cachedStores ?? [];
  }
  const arr = Array.isArray(json) ? json : [];
  const stores: ShipStationStoreSummary[] = arr
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      storeId: typeof s.storeId === "number" ? s.storeId : Number(s.storeId) || 0,
      storeName: (s.storeName as string) ?? null,
      marketplaceId: typeof s.marketplaceId === "number" ? s.marketplaceId : null,
      marketplaceName: (s.marketplaceName as string) ?? null,
      active: s.active !== false,
    }))
    .filter((s) => s.storeId > 0);
  cachedStores = stores;
  cachedStoresFetchedAt = Date.now();
  return stores;
}

/**
 * Resolve a ShipStation `storeId` to a canonical channel slug used by
 * `deriveAutoShipTag` ("amazon" | "shopify" | "faire") or `null` if the
 * store can't be matched (network error, unknown marketplace, etc.).
 *
 * Matches against `marketplaceName` first (ShipStation's authoritative
 * label, e.g. "Amazon", "Shopify"), then falls back to `storeName`
 * substring match for stores set up with a custom name. Case-insensitive
 * substring tolerant on both fields.
 */
export async function resolveChannelForStoreId(
  storeId: number | null | undefined,
): Promise<string | null> {
  if (!storeId || storeId <= 0) return null;
  const stores = await listShipStationStores();
  const match = stores.find((s) => s.storeId === storeId);
  if (!match) return null;
  const haystack = `${match.marketplaceName ?? ""} ${match.storeName ?? ""}`.toLowerCase();
  if (haystack.includes("amazon")) return "amazon";
  if (haystack.includes("shopify")) return "shopify";
  if (haystack.includes("faire")) return "faire";
  return null;
}

/**
 * Test/dev escape hatch: clear the cached stores list. Call between tests
 * to force a fresh fetch.
 */
export function clearShipStationStoresCache(): void {
  cachedStores = null;
  cachedStoresFetchedAt = 0;
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
  //
  // Carrier code is `ups_walleted` (UPS by ShipStation funding) NOT `ups`.
  // The `ups` code corresponds to a direct-UPS-account integration that
  // USA Gummies does NOT have on this ShipStation account — asking for it
  // returned "No applicable services" on 2026-04-20 and blocked the entire
  // fulfillment hub until we confirmed via GET /carriers. The connected
  // carriers are: stamps_com, ups_walleted, fedex_walleted, globalpost.
  // Anyone changing this code MUST re-verify via listShipStationCarriers()
  // and update the doctrine at /contracts/integrations/shipstation.md §4.
  const body = {
    carrierCode: "ups_walleted",
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
  /**
   * Wallet balance in USD for walleted carriers (stamps_com,
   * ups_walleted, fedex_walleted). `undefined` for carriers that
   * don't report a balance via `GET /carriers` (e.g. direct-account
   * integrations). Used by `preflightWalletCheck()` to refuse label
   * buys when the wallet can't cover them + the expected surcharge.
   */
  balance?: number;
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
    // IMPORTANT: ShipStation's /carriers endpoint returns *lowercase*
    // field names (`name`, `code`, `balance`, `requiresFundedAccount`,
    // `primary`) — NOT PascalCase. Verified against live response
    // 2026-04-20. Reading uppercase keys silently yields undefined
    // and made BUILD #2 preflight a no-op. Accept both shapes
    // defensively so a future ShipStation API change can't silently
    // re-break the wallet preflight.
    const raw = (await res.json()) as Array<{
      name?: string;
      code?: string;
      requiresFundedAccount?: boolean;
      primary?: boolean;
      balance?: number | null;
      // Legacy-shape defensive fallback.
      Name?: string;
      Code?: string;
      RequiresFundedAccount?: boolean;
      Primary?: boolean;
      Balance?: number | null;
    }>;
    const carriers = raw.map((c): CarrierInfo => {
      const balanceRaw = c.balance ?? c.Balance;
      return {
        name: c.name ?? c.Name ?? "",
        code: String(c.code ?? c.Code ?? ""),
        requiresFundedAccount: Boolean(
          c.requiresFundedAccount ?? c.RequiresFundedAccount,
        ),
        primary: Boolean(c.primary ?? c.Primary),
        balance: typeof balanceRaw === "number" ? balanceRaw : undefined,
      };
    });
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
}): Promise<{ ok: true; quote: CheapestRateQuote; allRates: CheapestRateQuote[] } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const carriersRes = await listShipStationCarriers();
  if (!carriersRes.ok) return { ok: false, error: carriersRes.error };

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

  // Flatten + exclude any zero/unreasonable rates + restricted services.
  // Restricted services (USPS Media Mail, Library Mail, etc.) are content-
  // class-restricted and CANNOT carry confection product. They're returned
  // by ShipStation as the "cheapest" rate but are illegal for our cargo.
  // Locked 2026-04-29 (Mike Hippler shipment prep — Media Mail surfaced as
  // winner for confection delivery, which violates USPS Domestic Mail Manual).
  const RESTRICTED_SERVICE_CODES = new Set<string>([
    "usps_media_mail",
    "usps_library_mail",
  ]);
  const candidates: CheapestRateQuote[] = [];
  for (const { carrier, rates } of rateResults) {
    for (const r of rates) {
      const perPackage = (r.shipmentCost ?? 0) + (r.otherCost ?? 0);
      if (!Number.isFinite(perPackage) || perPackage <= 0) continue;
      if (RESTRICTED_SERVICE_CODES.has(r.serviceCode)) continue;
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

  // Sort by total rate, return cheapest + the full table for inspection.
  candidates.sort((a, b) => a.rate - b.rate);
  return { ok: true, quote: candidates[0], allRates: candidates };
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

  // Map legacy `ups` carrier code to the correct `ups_walleted` so old
  // callers don't silently fail against the trial ShipStation account.
  // Remove this shim once every caller has been audited + migrated.
  const carrierCode = params.carrierCode === "ups" ? "ups_walleted" : params.carrierCode ?? "ups_walleted";
  const serviceCode = params.serviceCode ?? "ups_ground";

  const body = {
    carrierCode,
    serviceCode,
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
 *
 * Carrier is `ups_walleted` (UPS by ShipStation funded wallet) — NOT `ups`.
 * See the comment on the rate-quote body above for the full story.
 */
export async function createUpsGroundLabel(
  params: Omit<Parameters<typeof createShippingLabel>[0], "carrierCode" | "serviceCode">,
): Promise<{ ok: true; label: LabelResult } | { ok: false; error: string }> {
  return createShippingLabel({ ...params, carrierCode: "ups_walleted", serviceCode: "ups_ground" });
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
  /** ISO timestamp of the void, if shipment was voided. */
  voidDate: string | null;
  /** Label cost we paid — used by BUILD #9 refund reconciliation. */
  shipmentCost: number | null;
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
    voidDate?: string | null;
    shipmentCost?: number | null;
    insuranceCost?: number | null;
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
        voidDate: s.voidDate ?? null,
        shipmentCost:
          typeof s.shipmentCost === "number"
            ? Math.round(
                (s.shipmentCost + (s.insuranceCost ?? 0)) * 100,
              ) / 100
            : null,
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

// ---------------------------------------------------------------------------
// BUILD #2 — Preflight wallet-balance check
// ---------------------------------------------------------------------------
//
// Origin: on 2026-04-20, mid-rush, ShipStation ran out of wallet funds
// after buying Glacier's 2nd master-carton label. The next `createlabel`
// call failed with a cryptic 400. Ben had to manually reload the wallet
// ($50 + $100) from inside the ShipStation web UI twice — hard stop in
// the middle of the Red Dog buy loop.
//
// Fix: before every label purchase, read the carrier's wallet balance
// from `GET /carriers`, compare against `cost × safetyMultiplier`
// (default 1.2 → 20% headroom for surcharges + residential fees), and
// refuse the buy with a clear error message if the wallet would dip
// below the required surcharge. Callers surface the error to the
// operator (Slack ping or UI banner) so the human can top up.
//
// Non-walleted carriers (direct-account UPS / FedEx) don't report
// Balance, so the helper passes (skipped=true, balance=null) and the
// caller proceeds without blocking.

export interface PreflightWalletResult {
  /** `true` if either the balance covers the required threshold OR the
   *  carrier doesn't report a balance (walled check skipped). */
  ok: boolean;
  /** Wallet balance in USD. `null` when the carrier doesn't report it. */
  balance: number | null;
  /** The computed threshold: cost × safetyMultiplier. */
  required: number;
  /** The safety multiplier actually applied. */
  safetyMultiplier: number;
  /** `true` when the carrier didn't report a balance and we skipped the check. */
  skipped: boolean;
  /** Human-readable error; only populated when ok = false. */
  error?: string;
}

/**
 * Look up ShipStation wallet balance for a specific carrier code.
 *
 * Returns `balance = null` when the carrier exists but doesn't report
 * a balance (e.g. direct-account UPS — balance lives in the UPS
 * billing portal, not ShipStation). Returns `ok = false` only when
 * the /carriers call itself fails or the code isn't connected at all.
 */
export async function getShipStationWalletBalance(carrierCode: string): Promise<
  | { ok: true; carrierCode: string; balance: number | null }
  | { ok: false; error: string }
> {
  const res = await listShipStationCarriers();
  if (!res.ok) return { ok: false, error: res.error };
  const carrier = res.carriers.find((c) => c.code === carrierCode);
  if (!carrier) {
    return {
      ok: false,
      error: `Carrier '${carrierCode}' not connected on this ShipStation account`,
    };
  }
  return {
    ok: true,
    carrierCode,
    balance: typeof carrier.balance === "number" ? carrier.balance : null,
  };
}

/**
 * Refuse a label buy if the carrier's wallet balance can't cover the
 * expected cost with headroom. Callers should invoke this before
 * `createShippingLabel()` in any batch flow. See top-of-section
 * comment for context.
 */
export async function preflightWalletCheck(params: {
  carrierCode: string;
  /** Expected label cost in USD (use `getCheapestShipStationRate()` first). */
  costDollars: number;
  /** Headroom multiplier. Default 1.2 = 20% above quoted cost. */
  safetyMultiplier?: number;
}): Promise<PreflightWalletResult> {
  const safetyMultiplier = params.safetyMultiplier ?? 1.2;
  const required = Math.round(params.costDollars * safetyMultiplier * 100) / 100;

  const balRes = await getShipStationWalletBalance(params.carrierCode);
  if (!balRes.ok) {
    // /carriers failed outright — can't verify. Fail CLOSED so a
    // silent API outage doesn't let us ring up a no-funds error
    // mid-loop. Caller can override with safetyMultiplier=0.
    return {
      ok: false,
      balance: null,
      required,
      safetyMultiplier,
      skipped: false,
      error: `Wallet preflight failed: ${balRes.error}`,
    };
  }
  if (balRes.balance === null) {
    // Carrier doesn't report balance — skip the check cleanly.
    return {
      ok: true,
      balance: null,
      required,
      safetyMultiplier,
      skipped: true,
    };
  }
  if (balRes.balance < required) {
    return {
      ok: false,
      balance: balRes.balance,
      required,
      safetyMultiplier,
      skipped: false,
      error:
        `ShipStation ${params.carrierCode} wallet $${balRes.balance.toFixed(2)} ` +
        `below required $${required.toFixed(2)} ` +
        `(cost $${params.costDollars.toFixed(2)} × ${safetyMultiplier} safety). ` +
        `Top up the ${params.carrierCode} wallet in ShipStation UI before retrying.`,
    };
  }
  return {
    ok: true,
    balance: balRes.balance,
    required,
    safetyMultiplier,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// BUILD #3 — 504 idempotency recovery
// ---------------------------------------------------------------------------
//
// Origin: on 2026-04-20 (Red Dog buy loop), three createlabel calls
// returned HTTP 504 Gateway Timeout after the carrier had ALREADY
// created the shipment server-side. Stamps.com charged us $27.27
// each (×3 = $81.81) but ShipStation's response was lost, so we
// never got the PDFs. We voided all three to get refunds and re-bought.
//
// Fix: when createlabel returns a 5xx timeout, the caller should NOT
// auto-retry. Instead: wait ~5s, query ShipStation for any shipment
// created in the last ~2min matching our ship-to ZIP + name, and
// surface the candidate(s) so an operator can:
//   (a) accept the silent-success label if one appeared, or
//   (b) confirm no shipment was created and safely retry.
//
// This helper does (a) — callers decide what to do with the matches.

/**
 * After a createlabel timeout, look for any ShipStation shipment
 * created in the recent past that matches the destination we tried
 * to ship to. Used to recover from 504 Gateway Timeouts where the
 * shipment was created server-side but the response was dropped.
 *
 * Matches on ZIP + name (case-insensitive) and createDate within the
 * `withinMinutes` window. Returns matches ordered newest-first.
 */
export async function findRecentShipmentByAddress(params: {
  shipToPostalCode: string;
  shipToName?: string;
  /** Only consider shipments created within this many minutes. Default 10. */
  withinMinutes?: number;
}): Promise<ShipStationShipment[]> {
  const windowMs = (params.withinMinutes ?? 10) * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const res = await getRecentShipments({
    // ShipStation's shipDateStart filter is day-resolution — broad-cast
    // yesterday + today so we don't miss anything near midnight UTC.
    shipDateStart: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    includeVoided: false,
  });
  if (!res.ok) return [];
  const zip = params.shipToPostalCode.trim();
  const name = params.shipToName?.trim().toLowerCase();
  return res.shipments
    .filter((s) => {
      if (s.shipToPostalCode?.trim() !== zip) return false;
      if (name && s.shipToName?.toLowerCase() !== name) return false;
      if (!s.createDate) return false;
      return new Date(s.createDate).getTime() >= cutoff;
    })
    .sort((a, b) => {
      const aT = a.createDate ? new Date(a.createDate).getTime() : 0;
      const bT = b.createDate ? new Date(b.createDate).getTime() : 0;
      return bT - aT;
    });
}

// ---------------------------------------------------------------------------
// BUILD #9 — Voided-label refund watcher
// ---------------------------------------------------------------------------
//
// Stamps.com refunds void labels in batches — typically 24-48h,
// occasionally up to 14 days. On 2026-04-20 we voided 3 Red Dog labels
// ($81.81) + discovered 17 orphaned Viktor triple-buy voids ($130.90).
// Without a watcher, those could silently never refund and we'd eat
// the cost.
//
// This helper lists every voided shipment in a window and flags any
// whose void is older than `staleAfterHours` — those are exception
// candidates the Finance Exception Agent surfaces in its daily digest.
// Actual refund-credit reconciliation against the Stamps.com wallet
// ledger happens in the agent (not here), since that requires matching
// ledger transactions the v1 API doesn't expose.

export interface VoidedLabelSummary {
  shipmentId: number;
  carrierCode: string | null;
  trackingNumber: string | null;
  shipmentCost: number | null;
  createDate: string;
  voidDate: string | null;
  /** Hours elapsed since the void. null if voidDate is missing. */
  ageHours: number | null;
  /** True iff ageHours > staleAfterHours — worth checking the wallet ledger. */
  stale: boolean;
  shipToName: string | null;
  shipToPostalCode: string | null;
  orderNumber: string | null;
}

/**
 * List voided shipments in the recent past, annotating each with
 * an `ageHours` + `stale` flag. Used by the Finance Exception Agent's
 * daily digest to surface refunds that haven't landed within the
 * expected Stamps.com SLA window.
 */
export async function listVoidedLabels(opts: {
  /** Default 14 — Stamps.com outer refund window. */
  daysBack?: number;
  /** Default 72 — threshold after which a void-without-refund is suspicious. */
  staleAfterHours?: number;
}): Promise<
  | { ok: true; voided: VoidedLabelSummary[]; stale: VoidedLabelSummary[] }
  | { ok: false; error: string }
> {
  const daysBack = Math.max(1, Math.min(60, opts.daysBack ?? 14));
  const staleAfterHours = Math.max(1, opts.staleAfterHours ?? 72);
  const now = Date.now();

  const res = await getRecentShipments({
    shipDateStart: new Date(now - daysBack * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10),
    includeVoided: true,
    pageSize: 500,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const voided: VoidedLabelSummary[] = res.shipments
    .filter((s) => s.voided)
    .map((s) => {
      const voidedAt = s.voidDate ? new Date(s.voidDate).getTime() : null;
      const ageHours =
        voidedAt !== null ? Math.round(((now - voidedAt) / 36_000)) / 100 : null;
      return {
        shipmentId: s.shipmentId,
        carrierCode: s.carrierCode,
        trackingNumber: s.trackingNumber,
        shipmentCost: s.shipmentCost,
        createDate: s.createDate,
        voidDate: s.voidDate,
        ageHours,
        stale: ageHours !== null && ageHours > staleAfterHours,
        shipToName: s.shipToName,
        shipToPostalCode: s.shipToPostalCode,
        orderNumber: s.orderNumber,
      };
    });

  const stale = voided.filter((v) => v.stale);
  return { ok: true, voided, stale };
}

// ---------------------------------------------------------------------------
// Order-linked label flow (Amazon FBM auto-ship pipeline)
// ---------------------------------------------------------------------------
//
// When ShipStation has already ingested an order from Amazon (or Shopify),
// the *correct* way to buy a label is `POST /orders/createlabel` with the
// ShipStation-internal numeric `orderId` — NOT `/shipments/createlabel` with
// free-form ship-to. The linked flow does three things we need:
//
//   1. Uses the ship-to already on the ShipStation order (full PII that
//      the Amazon SP-API hides behind RDT for MFN orders).
//   2. Marks the ShipStation order as `shipped` atomically, so ShipStation's
//      own channel integration pushes tracking back to Amazon without a
//      second `/orders/markasshipped` call.
//   3. Attaches the carrier/service/tracking to the order record so the
//      order page in ShipStation matches what actually shipped.
//
// This is the primitive for the unified shipping queue — every channel
// (Amazon FBM, Shopify, Faire) that pushes orders into ShipStation uses
// the same lookup + createlabel pair.

export interface ShipStationOrderSummary {
  /** ShipStation-internal integer id (needed for /orders/createlabel). */
  orderId: number;
  /** Channel order id ("114-...", "#12345", etc.) — the lookup key. */
  orderNumber: string;
  orderStatus: string; // "awaiting_payment" | "awaiting_shipment" | "shipped" | "on_hold" | "cancelled"
  orderDate: string | null;
  customerEmail: string | null;
  /** Full ship-to (PII). */
  shipTo: {
    name: string | null;
    company: string | null;
    street1: string | null;
    street2: string | null;
    street3: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
    residential: boolean | null;
  };
  /** Line items — for packaging + weight inference. */
  items: Array<{ sku: string | null; name: string | null; quantity: number }>;
  /** Order-level weight if ShipStation computed one. */
  weight: { value: number; units: string } | null;
  /** Advanced marketplace metadata (storeId identifies which channel). */
  advancedOptions: {
    storeId: number | null;
    customField1: string | null;
    source: string | null;
  };
}

/**
 * Fetch a single ShipStation order by its channel-side orderNumber.
 *
 * ShipStation's `/orders` endpoint supports `orderNumber` as a query
 * param and returns any orders matching (usually just one per channel).
 * We narrow to `awaiting_shipment` by default because that's what the
 * queue feeds into — already-shipped matches would be no-ops.
 *
 * Returns null (ok: true, order: null) if no match — callers decide
 * whether that's a degraded state or a normal "already shipped" skip.
 */
export async function findShipStationOrderByNumber(
  orderNumber: string,
  opts: { status?: string } = {},
): Promise<
  | { ok: true; order: ShipStationOrderSummary | null }
  | { ok: false; error: string }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const status = opts.status ?? "awaiting_shipment";
  const url = new URL("https://ssapi.shipstation.com/orders");
  url.searchParams.set("orderNumber", orderNumber);
  url.searchParams.set("orderStatus", status);
  url.searchParams.set("pageSize", "10");

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
    return {
      ok: false,
      error: `ShipStation ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const data = (await res.json()) as {
    orders?: Array<Record<string, unknown>>;
  };
  const raw = (data.orders ?? []).find((o) => {
    const on = (o as { orderNumber?: string }).orderNumber;
    return typeof on === "string" && on === orderNumber;
  }) ?? (data.orders ?? [])[0];

  if (!raw) return { ok: true, order: null };

  const o = raw as {
    orderId: number;
    orderNumber: string;
    orderStatus: string;
    orderDate: string | null;
    customerEmail: string | null;
    shipTo?: Record<string, unknown> | null;
    items?: Array<Record<string, unknown>>;
    weight?: { value?: number; units?: string } | null;
    advancedOptions?: Record<string, unknown>;
  };

  const shipToRaw = (o.shipTo ?? {}) as Record<string, unknown>;
  const adv = (o.advancedOptions ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    order: {
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      orderDate: o.orderDate ?? null,
      customerEmail: o.customerEmail ?? null,
      shipTo: {
        name: (shipToRaw.name as string) ?? null,
        company: (shipToRaw.company as string) ?? null,
        street1: (shipToRaw.street1 as string) ?? null,
        street2: (shipToRaw.street2 as string) ?? null,
        street3: (shipToRaw.street3 as string) ?? null,
        city: (shipToRaw.city as string) ?? null,
        state: (shipToRaw.state as string) ?? null,
        postalCode: (shipToRaw.postalCode as string) ?? null,
        country: (shipToRaw.country as string) ?? null,
        phone: (shipToRaw.phone as string) ?? null,
        residential: (shipToRaw.residential as boolean) ?? null,
      },
      items: (o.items ?? []).map((i) => {
        const it = i as { sku?: string; name?: string; quantity?: number };
        return {
          sku: it.sku ?? null,
          name: it.name ?? null,
          quantity: it.quantity ?? 0,
        };
      }),
      weight:
        o.weight && typeof o.weight.value === "number"
          ? { value: o.weight.value, units: o.weight.units ?? "ounces" }
          : null,
      advancedOptions: {
        storeId: (adv.storeId as number) ?? null,
        customField1: (adv.customField1 as string) ?? null,
        source: (adv.source as string) ?? null,
      },
    },
  };
}

/**
 * List every `awaiting_shipment` order across all connected stores.
 *
 * This is the unified-shipping-queue primitive: Amazon FBM, Shopify
 * DTC, Faire (when wired), and manual orders all land in the same
 * ShipStation awaiting-shipment bucket. Instead of polling each
 * channel's source API separately, one call here returns them all.
 *
 * Returns the same `ShipStationOrderSummary` shape as
 * `findShipStationOrderByNumber` so downstream consumers don't branch
 * on channel — they just iterate and ship.
 *
 * Pagination: fetches up to `pageSize` orders in one shot (default
 * 200). For a store this size that comfortably covers one ship day.
 * Extend with a pagination loop if the queue ever grows past a page.
 */
export async function listOrdersAwaitingShipment(opts: {
  storeId?: number;
  pageSize?: number;
} = {}): Promise<
  | { ok: true; orders: ShipStationOrderSummary[] }
  | { ok: false; error: string }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const url = new URL("https://ssapi.shipstation.com/orders");
  url.searchParams.set("orderStatus", "awaiting_shipment");
  url.searchParams.set("pageSize", String(opts.pageSize ?? 200));
  url.searchParams.set("sortBy", "CreateDate");
  url.searchParams.set("sortDir", "ASC");
  if (typeof opts.storeId === "number") {
    url.searchParams.set("storeId", String(opts.storeId));
  }

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
    return {
      ok: false,
      error: `ShipStation ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const data = (await res.json()) as {
    orders?: Array<Record<string, unknown>>;
  };
  const orders: ShipStationOrderSummary[] = (data.orders ?? []).map((raw) => {
    const o = raw as {
      orderId: number;
      orderNumber: string;
      orderStatus: string;
      orderDate: string | null;
      customerEmail: string | null;
      shipTo?: Record<string, unknown> | null;
      items?: Array<Record<string, unknown>>;
      weight?: { value?: number; units?: string } | null;
      advancedOptions?: Record<string, unknown>;
    };
    const shipToRaw = (o.shipTo ?? {}) as Record<string, unknown>;
    const adv = (o.advancedOptions ?? {}) as Record<string, unknown>;
    return {
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      orderDate: o.orderDate ?? null,
      customerEmail: o.customerEmail ?? null,
      shipTo: {
        name: (shipToRaw.name as string) ?? null,
        company: (shipToRaw.company as string) ?? null,
        street1: (shipToRaw.street1 as string) ?? null,
        street2: (shipToRaw.street2 as string) ?? null,
        street3: (shipToRaw.street3 as string) ?? null,
        city: (shipToRaw.city as string) ?? null,
        state: (shipToRaw.state as string) ?? null,
        postalCode: (shipToRaw.postalCode as string) ?? null,
        country: (shipToRaw.country as string) ?? null,
        phone: (shipToRaw.phone as string) ?? null,
        residential: (shipToRaw.residential as boolean) ?? null,
      },
      items: (o.items ?? []).map((i) => {
        const it = i as { sku?: string; name?: string; quantity?: number };
        return {
          sku: it.sku ?? null,
          name: it.name ?? null,
          quantity: it.quantity ?? 0,
        };
      }),
      weight:
        o.weight && typeof o.weight.value === "number"
          ? { value: o.weight.value, units: o.weight.units ?? "ounces" }
          : null,
      advancedOptions: {
        storeId: (adv.storeId as number) ?? null,
        customField1: (adv.customField1 as string) ?? null,
        source: (adv.source as string) ?? null,
      },
    };
  });
  return { ok: true, orders };
}

export interface OrderLinkedLabelParams {
  /** ShipStation internal numeric orderId from findShipStationOrderByNumber(). */
  orderId: number;
  /** The channel orderNumber — passed through to the label so it matches the order. */
  orderNumber: string;
  /** Ship-to pulled from the ShipStation order (ship-to PII). */
  shipTo: LabelDestination;
  carrierCode: string;
  serviceCode: string;
  packageCode?: string;
  confirmation?: "none" | "delivery" | "signature" | "adult_signature";
  /** Packed weight — required. For USPS First-Class use ounces; otherwise pounds works too. */
  weight: { value: number; units: "ounces" | "pounds" | "grams" };
  dimensions?: { length: number; width: number; height: number; units?: "inches" | "centimeters" };
  shipDate?: string;
  testLabel?: boolean;
  /** Whether to notify the buyer / push tracking back to the source marketplace. */
  notifyCustomer?: boolean;
  notifySalesChannel?: boolean;
}

/**
 * Buy a label via `/shipments/createlabel` AND mark the linked ShipStation
 * order shipped via `/orders/markasshipped`. The v1 API has no single
 * "createlabel on existing order" endpoint (the docs advertise one but
 * it returns 404 in production — verified 2026-04-22 with orderId
 * 287563638, 287853740, 287921615). So we do it in two calls:
 *
 *   1. POST /shipments/createlabel — creates a free-standing shipment
 *      with the full ship-to pulled from the existing order. Returns
 *      tracking + label PDF (base64).
 *   2. POST /orders/markasshipped — links the tracking back to the
 *      ShipStation order record. With `notifySalesChannel=true` this
 *      pushes the tracking to the source marketplace (Amazon Seller
 *      Central, Shopify Orders) within a few minutes.
 *
 * If step 1 succeeds and step 2 fails, the label is already paid for
 * and printable — caller gets `ok: true` with a `markShippedError`
 * warning so Ben can mark manually. This avoids double-buying.
 */
export async function createLabelForShipStationOrder(
  params: OrderLinkedLabelParams,
): Promise<
  | { ok: true; label: LabelResult; markShippedOk: boolean; markShippedError?: string }
  | { ok: false; error: string }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  // ---- Step 1: buy the label via /shipments/createlabel
  const from = getShipFromAddress();
  const weightOunces =
    params.weight.units === "pounds"
      ? params.weight.value * 16
      : params.weight.units === "grams"
        ? params.weight.value / 28.3495
        : params.weight.value;
  // Default mailer dimensions when caller didn't override.
  const dims =
    params.dimensions ??
    { length: 9, width: 6, height: 2, units: "inches" as const };

  const labelBody = {
    carrierCode: params.carrierCode,
    serviceCode: params.serviceCode,
    packageCode: params.packageCode ?? "package",
    confirmation: params.confirmation ?? "delivery",
    shipDate: params.shipDate ?? new Date().toISOString().slice(0, 10),
    weight: { value: Math.round(weightOunces * 10) / 10, units: "ounces" },
    dimensions: {
      units: dims.units ?? "inches",
      length: dims.length,
      width: dims.width,
      height: dims.height,
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
      name: params.shipTo.name,
      company: params.shipTo.company,
      street1: params.shipTo.street1,
      street2: params.shipTo.street2,
      city: params.shipTo.city,
      state: params.shipTo.state.trim().toUpperCase(),
      postalCode: params.shipTo.postalCode.trim(),
      country: (params.shipTo.country || "US").trim().toUpperCase(),
      phone: params.shipTo.phone,
      residential: params.shipTo.residential ?? true,
    },
    testLabel: params.testLabel ?? false,
    internalNotes: params.orderNumber,
  };

  let labelRes: Response;
  try {
    labelRes = await fetch("https://ssapi.shipstation.com/shipments/createlabel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(labelBody),
    });
  } catch (err) {
    return {
      ok: false,
      error: `ShipStation request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!labelRes.ok) {
    const text = await labelRes.text().catch(() => "");
    return {
      ok: false,
      error: `ShipStation createlabel ${labelRes.status}: ${text.slice(0, 400)}`,
    };
  }
  const labelData = (await labelRes.json()) as ShipStationLabelResponse;
  const tracking = labelData.trackingNumber?.trim();
  if (!tracking) {
    return { ok: false, error: "ShipStation returned no tracking number" };
  }
  const labelUrl = labelData.labelData
    ? `data:application/pdf;base64,${labelData.labelData}`
    : "";
  const cost =
    (typeof labelData.shipmentCost === "number" ? labelData.shipmentCost : 0) +
    (typeof labelData.insuranceCost === "number" ? labelData.insuranceCost : 0);
  const carrierUsed = labelData.carrierCode ?? params.carrierCode ?? "";
  const serviceUsed = labelData.serviceCode ?? params.serviceCode ?? "";
  const label: LabelResult = {
    carrier: carrierUsed.toUpperCase(),
    service: humanizeService(serviceUsed),
    serviceCode: serviceUsed,
    trackingNumber: tracking,
    labelUrl,
    cost: Math.round(cost * 100) / 100,
    shipmentId: labelData.shipmentId ?? null,
  };

  // ---- Step 2: mark the ShipStation order shipped so it syncs back to Amazon
  const markBody = {
    orderId: params.orderId,
    carrierCode: params.carrierCode,
    shipDate: params.shipDate ?? new Date().toISOString().slice(0, 10),
    trackingNumber: tracking,
    notifyCustomer: params.notifyCustomer ?? false, // Amazon sends its own email
    notifySalesChannel: params.notifySalesChannel ?? true,
  };

  let markRes: Response;
  try {
    markRes = await fetch("https://ssapi.shipstation.com/orders/markasshipped", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(markBody),
    });
  } catch (err) {
    return {
      ok: true,
      label,
      markShippedOk: false,
      markShippedError: `markasshipped request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!markRes.ok) {
    const text = await markRes.text().catch(() => "");
    return {
      ok: true,
      label,
      markShippedOk: false,
      markShippedError: `ShipStation markasshipped ${markRes.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true, label, markShippedOk: true };
}

// ---------------------------------------------------------------------------
// Void + re-ship primitives
// ---------------------------------------------------------------------------
//
// When we need to cancel an already-purchased label and re-buy it (common
// reason: wrong ship-from, wrong service, address correction), these two
// helpers handle the lookup + void. Re-buying uses the existing
// createLabelForShipStationOrder() — ShipStation's /shipments/createlabel
// is agnostic to whether the order already has a shipment attached.

/**
 * Find every non-voided shipment on a given ShipStation order. Used before
 * a void-and-rebuy so we can void each outstanding label (ShipStation
 * tracks one shipment per label, but multi-box orders can have several).
 */
export async function findShipmentsByOrderNumber(
  orderNumber: string,
  opts: { includeVoided?: boolean; daysBack?: number; orderId?: number } = {},
): Promise<
  | { ok: true; shipments: ShipStationShipment[] }
  | { ok: false; error: string }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  // ShipStation's /shipments endpoint has inconsistent filter behavior:
  // both `orderNumber` and `orderId` query params silently returned 0
  // rows against live shipments (verified 2026-04-23 with orderNumber
  // "114-6802942-8357867" / orderId 287563638). The SAME endpoint
  // returns all recent shipments correctly when filtered only by
  // `shipDateStart` (getRecentShipments proves this).
  //
  // Workaround: hit the endpoint with ONLY a ship-date window (no
  // orderId/orderNumber filter), then filter client-side by matching
  // orderId or orderNumber. This trades a larger page of data for
  // guaranteed correctness. For the typical 7-day window this is ≤ a
  // few hundred shipments — trivial to sift.
  const daysBack = Math.max(1, opts.daysBack ?? 30);
  const dateStart = new Date(Date.now() - daysBack * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const url = new URL("https://ssapi.shipstation.com/shipments");
  url.searchParams.set("shipDateStart", dateStart);
  url.searchParams.set("includeShipmentItems", "false");
  url.searchParams.set("pageSize", "500");
  url.searchParams.set("sortBy", "CreateDate");
  url.searchParams.set("sortDir", "DESC");

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
    return {
      ok: false,
      error: `ShipStation ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const data = (await res.json()) as ShipStationShipmentsListResponse;
  const shipments: ShipStationShipment[] = (data.shipments ?? []).map((s) => ({
    shipmentId: s.shipmentId,
    orderId: s.orderId ?? null,
    orderNumber: s.orderNumber ?? null,
    createDate: s.createDate ?? "",
    shipDate: s.shipDate ?? null,
    trackingNumber: s.trackingNumber ?? null,
    carrierCode: s.carrierCode ?? null,
    serviceCode: s.serviceCode ?? null,
    voided: Boolean(s.voided),
    voidDate: s.voidDate ?? null,
    shipmentCost: s.shipmentCost ?? null,
    shipToName: s.shipTo?.name ?? null,
    shipToPostalCode: s.shipTo?.postalCode ?? null,
  }));

  // Client-side filter: match by orderId (preferred) or orderNumber.
  // The API's server-side filters for these fields silently return 0
  // rows — see the endpoint comment above for context.
  const matchingOrderId =
    typeof opts.orderId === "number" && Number.isFinite(opts.orderId)
      ? opts.orderId
      : null;
  const matched = shipments.filter((s) => {
    if (matchingOrderId !== null) return s.orderId === matchingOrderId;
    return s.orderNumber === orderNumber;
  });

  const filtered = opts.includeVoided
    ? matched
    : matched.filter((s) => !s.voided);
  return { ok: true, shipments: filtered };
}

/**
 * Void a ShipStation label. Refunds the postage to the carrier's wallet
 * (Stamps.com typically refunds in ~30 days). ShipStation keeps the
 * shipment record but flags `voided: true` — the order itself does NOT
 * revert to awaiting_shipment automatically.
 */
export async function voidShipStationLabel(
  shipmentId: number,
): Promise<
  | { ok: true; message: string }
  | { ok: false; error: string; approved?: boolean }
> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/shipments/voidlabel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ shipmentId }),
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
      error: `ShipStation voidlabel ${res.status}: ${text.slice(0, 200)}`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    approved?: boolean;
    message?: string;
  };
  if (data.approved === false) {
    return {
      ok: false,
      approved: false,
      error: data.message || "ShipStation did not approve the void",
    };
  }
  return { ok: true, message: data.message || "Label voided" };
}

/**
 * Reset a ShipStation order back to `awaiting_shipment` by re-POSTing it
 * via `/orders/createorder` (same endpoint creates + updates). Used after
 * a void so we can re-buy a label on the same order without the UI
 * showing it as "shipped with a voided shipment."
 *
 * We re-post the minimum fields to update orderStatus in place. Existing
 * ship-to, items, etc. on the ShipStation side are preserved because we
 * pass the full order payload we just fetched.
 */
export async function restoreOrderToAwaitingShipment(
  existing: ShipStationOrderSummary,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) return { ok: false, error: "ShipStation credentials not configured" };

  const body = {
    orderNumber: existing.orderNumber,
    orderDate: existing.orderDate || new Date().toISOString(),
    orderStatus: "awaiting_shipment",
    customerEmail: existing.customerEmail ?? undefined,
    billTo: { name: existing.shipTo.name ?? "Buyer" },
    shipTo: {
      name: existing.shipTo.name,
      company: existing.shipTo.company,
      street1: existing.shipTo.street1,
      street2: existing.shipTo.street2,
      street3: existing.shipTo.street3,
      city: existing.shipTo.city,
      state: existing.shipTo.state,
      postalCode: existing.shipTo.postalCode,
      country: existing.shipTo.country ?? "US",
      phone: existing.shipTo.phone,
      residential: existing.shipTo.residential,
    },
    items: existing.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
    })),
    advancedOptions: {
      storeId: existing.advancedOptions.storeId ?? undefined,
      source: existing.advancedOptions.source ?? undefined,
      customField1: existing.advancedOptions.customField1 ?? undefined,
    },
  };

  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/orders/createorder", {
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
      error: `ShipStation createorder ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true };
}
