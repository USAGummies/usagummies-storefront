/**
 * ShipStation Rate-Quote Client — USA Gummies
 *
 * Pulls real-time UPS Ground rates from Ashford, WA (origin) to a destination
 * ZIP for wholesale booth orders. Used by /api/booth-order/freight-quote so
 * the booth form can show a live freight number before the customer submits.
 *
 * Auth: HTTP Basic with `SHIPSTATION_API_KEY:SHIPSTATION_API_SECRET`.
 * Docs: https://www.shipstation.com/docs/api/shipments/get-rates/
 */
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Origin + master-case spec (Ashford, WA warehouse → wholesale buyer)
// ---------------------------------------------------------------------------

export const BOOTH_ORIGIN_ZIP = "98304"; // Mettler warehouse, Ashford WA

// Master case = 6 inner cases × 6 bags = 36 bags. Per Notion 3/18 packaging
// notes: master carton ~21 × 14 × 8" estimated. Bag gross weight ~8.25 oz, so
// 36 × 8.25 oz ≈ 18.6 lb of bags + boxes/strips ≈ ~24 lb finished MC.
export const BOOTH_MC_DIMS = { length: 21, width: 14, height: 8 } as const;
export const BOOTH_MC_WEIGHT_LBS = 24;

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
  qtyMasterCases: number;
  residential?: boolean;
}): Promise<{ ok: true; quote: FreightQuote } | { ok: false; error: string }> {
  const auth = getAuthHeader();
  if (!auth) {
    return { ok: false, error: "ShipStation credentials not configured" };
  }

  const qty = Math.max(1, Math.floor(params.qtyMasterCases));
  if (!/^\d{5}(-\d{4})?$/.test(params.toZip.trim())) {
    return { ok: false, error: "Invalid ZIP code" };
  }
  if (!/^[A-Z]{2}$/.test(params.toState.trim().toUpperCase())) {
    return { ok: false, error: "Invalid state code" };
  }

  // ShipStation rates a single package per call. For multi-MC orders we
  // quote one MC and multiply. UPS Ground rate scales nearly linearly with
  // package count when dims are identical; fine approximation for booth
  // orders, and avoids needing a multi-package endpoint.
  const body = {
    carrierCode: "ups",
    serviceCode: "ups_ground",
    packageCode: "package",
    fromPostalCode: BOOTH_ORIGIN_ZIP,
    toState: params.toState.trim().toUpperCase(),
    toCountry: "US",
    toPostalCode: params.toZip.trim(),
    weight: { value: BOOTH_MC_WEIGHT_LBS, units: "pounds" },
    dimensions: {
      units: "inches",
      length: BOOTH_MC_DIMS.length,
      width: BOOTH_MC_DIMS.width,
      height: BOOTH_MC_DIMS.height,
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
