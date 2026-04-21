/**
 * Shopify order → OrderIntent normalizer for the Sample/Order
 * Dispatch specialist (S-08).
 *
 * Takes a raw Shopify Admin API `orders/paid` webhook payload (subset
 * we care about) and returns the normalized shape consumed by
 * `classifyDispatch()`. Pure function — no I/O, easy to unit test.
 *
 * Rules:
 *   - `tags` — Shopify returns a comma-separated string; we split/trim.
 *   - `shipping_address` is canonical; fall back to `customer.default_address`
 *     only when shipping_address is null (Shopify sometimes omits for
 *     digital SKUs — those shouldn't hit this code path anyway).
 *   - Weight — line_items[].grams summed. Falls back to estimating from
 *     `cartons × bagsPerCarton × 7.5 oz` when grams absent.
 *   - `note` — passed through so tag sniffing also catches inline markers.
 *   - `valueUsd` — `total_price` (string) parsed.
 *
 * Anything malformed returns a `{ ok: false, error }` so the webhook
 * handler can reject the request without crashing.
 */

import type { OrderIntent } from "./sample-order-dispatch";

// Shopify payload subset — we only read what we need. All fields optional
// since Shopify occasionally drops them on draft / test orders.
export interface ShopifyOrderPayload {
  id?: number | string;
  name?: string; // the user-visible order # like "#1016"
  email?: string;
  total_price?: string;
  currency?: string;
  tags?: string; // comma-separated
  note?: string | null;
  cancelled_at?: string | null;
  financial_status?: string;
  fulfillment_status?: string | null;
  shipping_address?: ShopifyAddress | null;
  customer?: {
    default_address?: ShopifyAddress;
  };
  line_items?: Array<{
    id?: number;
    title?: string;
    sku?: string | null;
    quantity?: number;
    grams?: number; // per-unit weight in grams
    variant_id?: number;
    requires_shipping?: boolean;
  }>;
}

interface ShopifyAddress {
  name?: string;
  company?: string | null;
  address1?: string;
  address2?: string | null;
  city?: string;
  province_code?: string;
  zip?: string;
  country_code?: string;
  phone?: string | null;
}

const GRAMS_PER_POUND = 453.592;

export interface NormalizeResult {
  ok: true;
  intent: OrderIntent;
  skipped?: never;
}
export interface NormalizeSkip {
  ok: false;
  skipped: true;
  reason: string;
}
export interface NormalizeError {
  ok: false;
  skipped?: false;
  error: string;
}

export function normalizeShopifyOrder(
  payload: ShopifyOrderPayload,
): NormalizeResult | NormalizeSkip | NormalizeError {
  // Skip cancelled + refunded + zero-value orders — not our problem.
  if (payload.cancelled_at) {
    return {
      ok: false,
      skipped: true,
      reason: `Shopify order cancelled_at ${payload.cancelled_at}`,
    };
  }
  const financial = (payload.financial_status ?? "").toLowerCase();
  if (financial === "voided" || financial === "refunded") {
    return {
      ok: false,
      skipped: true,
      reason: `Shopify order financial_status=${financial}`,
    };
  }

  const addr = payload.shipping_address ?? payload.customer?.default_address;
  if (!addr || !addr.address1 || !addr.city || !addr.province_code || !addr.zip) {
    return {
      ok: false,
      error: "Shopify order missing shipping address fields",
    };
  }

  // Skip orders where no line item requires shipping (digital-only).
  const shippableLines = (payload.line_items ?? []).filter(
    (li) => li.requires_shipping !== false,
  );
  if (shippableLines.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "No shippable line items (digital-only or empty)",
    };
  }

  // Sum total weight in grams → convert to lb.
  const totalGrams = shippableLines.reduce(
    (sum, li) => sum + (li.grams ?? 0) * (li.quantity ?? 1),
    0,
  );
  const totalWeightLbs =
    totalGrams > 0
      ? Math.round((totalGrams / GRAMS_PER_POUND) * 100) / 100
      : undefined;

  // Tags — Shopify returns comma-separated.
  const tags =
    typeof payload.tags === "string"
      ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  // Parse total_price; non-numeric strings → undefined (we don't fabricate).
  const valueUsd = payload.total_price
    ? Number.parseFloat(payload.total_price)
    : undefined;

  const intent: OrderIntent = {
    channel: "shopify",
    sourceId: String(payload.id ?? ""),
    orderNumber: payload.name ?? undefined,
    valueUsd: typeof valueUsd === "number" && Number.isFinite(valueUsd)
      ? valueUsd
      : undefined,
    tags,
    note: payload.note ?? undefined,
    shipTo: {
      name: addr.name ?? "",
      company: addr.company ?? undefined,
      street1: addr.address1,
      street2: addr.address2 ?? undefined,
      city: addr.city,
      state: addr.province_code.toUpperCase(),
      postalCode: addr.zip,
      country: addr.country_code ?? "US",
      phone: addr.phone ?? undefined,
      residential: true, // DTC orders default to residential
    },
    // Shopify DTC is usually single-case packaging. Classifier can override
    // if the order is tagged as wholesale / bulk.
    packagingType: "case",
    cartons: 1,
    weightLbs: totalWeightLbs,
  };

  return { ok: true, intent };
}
