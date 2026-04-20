/**
 * Pirate Ship client — USPS-only (Commercial Plus Pricing).
 *
 * Pirate Ship ≠ ShipStation. They're alternatives, not integrations.
 * Pirate Ship specializes in discounted USPS labels (Commercial Plus
 * tier by default, often 10–25% below ShipStation's USPS rates for
 * small packages). They don't carry UPS or FedEx.
 *
 * Usage pattern: for every destination, call both Pirate Ship and
 * ShipStation in parallel and pick the cheapest. At 21 lb master
 * cartons on Ground routes, ShipStation+UPS usually wins. On < 5 lb
 * sample packs (especially to AK/HI), Pirate Ship USPS usually wins.
 *
 * Auth: X-Pirate-Auth-Token header with `PIRATESHIP_API_TOKEN`. Until
 * Ben provisions that token, this module's exports all return
 * `{ ok: false, unavailable: true }` — the fulfillment hub then just
 * compares ShipStation rates.
 */

const API_BASE = "https://api.pirateship.com/v2";

export function isPirateShipConfigured(): boolean {
  return (process.env.PIRATESHIP_API_TOKEN?.trim() ?? "") !== "";
}

function authHeader(): string | null {
  const token = process.env.PIRATESHIP_API_TOKEN?.trim();
  if (!token) return null;
  return token;
}

export interface PirateShipQuote {
  provider: "pirateship";
  carrier: string;
  service: string;
  serviceCode: string;
  rate: number;
  deliveryDays: number | null;
  perPackage: number;
}

interface PirateShipRateResponse {
  rates?: Array<{
    carrier?: string;
    service?: string;
    service_code?: string;
    cost?: number | string;
    delivery_days?: number | null;
  }>;
}

/**
 * Rate-quote USPS services via Pirate Ship for the given destination
 * + package. Uses the same weight/dimension profile as our ShipStation
 * client so comparisons are apples-to-apples.
 *
 * Returns null + reason if:
 *   - PIRATESHIP_API_TOKEN not set (degraded, not an error)
 *   - The API call fails or returns no rates (surfaced as unavailable)
 */
export async function getPirateShipCheapest(params: {
  toZip: string;
  toState: string;
  fromZip: string;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  quantity: number;
}): Promise<
  { ok: true; quote: PirateShipQuote } | { ok: false; unavailable: true; reason: string }
> {
  const token = authHeader();
  if (!token) {
    return {
      ok: false,
      unavailable: true,
      reason: "PIRATESHIP_API_TOKEN not configured",
    };
  }

  const body = {
    from_postal_code: params.fromZip,
    to_postal_code: params.toZip,
    to_state: params.toState,
    to_country: "US",
    weight: { value: params.weightLbs, units: "pounds" },
    dimensions: {
      length: params.lengthIn,
      width: params.widthIn,
      height: params.heightIn,
      units: "inches",
    },
  };

  try {
    const res = await fetch(`${API_BASE}/rates`, {
      method: "POST",
      headers: {
        "X-Pirate-Auth-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        ok: false,
        unavailable: true,
        reason: `Pirate Ship ${res.status}`,
      };
    }
    const data = (await res.json()) as PirateShipRateResponse;
    const rates = data.rates ?? [];
    if (rates.length === 0) {
      return {
        ok: false,
        unavailable: true,
        reason: "Pirate Ship returned no rates",
      };
    }
    // Pick cheapest parseable rate.
    const parsed = rates
      .map((r) => {
        const cost = Number(r.cost);
        return {
          carrier: r.carrier ?? "USPS",
          service: r.service ?? "USPS",
          serviceCode: r.service_code ?? "usps",
          perPackage: Number.isFinite(cost) ? cost : NaN,
          deliveryDays: r.delivery_days ?? null,
        };
      })
      .filter((r) => Number.isFinite(r.perPackage) && r.perPackage > 0)
      .sort((a, b) => a.perPackage - b.perPackage);
    if (parsed.length === 0) {
      return {
        ok: false,
        unavailable: true,
        reason: "Pirate Ship rates malformed",
      };
    }
    const cheapest = parsed[0];
    return {
      ok: true,
      quote: {
        provider: "pirateship",
        carrier: cheapest.carrier,
        service: cheapest.service,
        serviceCode: cheapest.serviceCode,
        rate: Math.round(cheapest.perPackage * Math.max(1, params.quantity) * 100) / 100,
        deliveryDays: cheapest.deliveryDays,
        perPackage: Math.round(cheapest.perPackage * 100) / 100,
      },
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
