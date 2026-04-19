/**
 * ShipStation Rate-Quote Client — USA Gummies
 *
 * Pulls real-time UPS Ground rates from Ashford, WA (origin) to a destination
 * ZIP for wholesale quick-order shipments. Used by /api/booth-order/freight-quote
 * so the booth form can show a live freight number before the customer submits.
 *
 * Auth: HTTP Basic with `SHIPSTATION_API_KEY:SHIPSTATION_API_SECRET`.
 * Docs: https://www.shipstation.com/docs/api/shipments/get-rates/
 */
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Origin + package specs (Ashford, WA warehouse → wholesale buyer)
// ---------------------------------------------------------------------------

export const BOOTH_ORIGIN_ZIP = "98304"; // Mettler warehouse, Ashford WA

export type ShippingPackageType = "bag" | "case" | "master_carton";

// The quick-order flow needs workable shipping estimates for one-off bag,
// case, and master-carton sales. The bag/case specs are conservative retail
// shipping approximations; the master carton matches the existing 36-unit
// shipper assumptions already used in the booth flow.
const PACKAGE_PROFILES: Record<
  ShippingPackageType,
  {
    length: number;
    width: number;
    height: number;
    weightLbs: number;
  }
> = {
  bag: { length: 10, width: 8, height: 3, weightLbs: 1 },
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
  const profile = PACKAGE_PROFILES[params.packagingType];
  if (!profile) {
    return { ok: false, error: "Invalid packaging type" };
  }
  if (!/^\d{5}(-\d{4})?$/.test(params.toZip.trim())) {
    return { ok: false, error: "Invalid ZIP code" };
  }
  if (!/^[A-Z]{2}$/.test(params.toState.trim().toUpperCase())) {
    return { ok: false, error: "Invalid state code" };
  }

  // ShipStation rates a single package per call. For multi-package orders we
  // quote one package and multiply. UPS Ground scales closely enough for
  // identical bag/case/carton packages, which is sufficient for the quick
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
