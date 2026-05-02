import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-31X673PSVY";
const GA4_API_SECRET = process.env.GA4_API_SECRET?.trim();
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
const META_PIXEL_ID = "26033875762978520";
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN?.trim();

type ShopifyLineItem = {
  id?: number | string;
  product_id?: number | string;
  variant_id?: number | string;
  sku?: string | null;
  title?: string | null;
  variant_title?: string | null;
  quantity?: number;
  price?: string | number;
};

type ShopifyAddress = {
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  province_code?: string | null;
  province?: string | null;
  zip?: string | null;
  country_code?: string | null;
  country?: string | null;
  phone?: string | null;
};

type ShopifyClientDetails = {
  user_agent?: string | null;
  browser_ip?: string | null;
};

type ShopifyNoteAttribute = { name?: string; value?: string };

type ShopifyOrder = {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  created_at?: string;
  currency?: string;
  presentment_currency?: string;
  total_price?: string | number;
  current_total_price?: string | number;
  total_tax?: string | number;
  current_total_tax?: string | number;
  total_shipping_price_set?: { shop_money?: { amount?: string | number } };
  total_shipping_price?: string | number;
  line_items?: ShopifyLineItem[];
  discount_codes?: Array<{ code?: string }>;
  // Identity payload — required for Meta CAPI conversion matching.
  // Without these, Meta receives the event but can't tie it to a click,
  // so the optimizer treats it as unattributable noise.
  email?: string | null;
  phone?: string | null;
  customer?: { email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null } | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  client_details?: ShopifyClientDetails | null;
  // Cart attributes carry fbp/fbc cookies captured pre-checkout on /go.
  note_attributes?: ShopifyNoteAttribute[];
};

function sha256Hex(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value.replace(/\D/g, "");
  return stripped || null;
}

function buildMetaUserData(order: ShopifyOrder): Record<string, unknown> {
  const ud: Record<string, unknown> = {};

  // Email — primary match key
  const email = order.email || order.customer?.email || null;
  const emailHash = sha256Hex(email);
  if (emailHash) ud.em = [emailHash];

  // Phone — secondary match key (digits only, no formatting)
  const phone = order.phone || order.customer?.phone || order.billing_address?.phone || order.shipping_address?.phone || null;
  const phoneHash = sha256Hex(digitsOnly(phone));
  if (phoneHash) ud.ph = [phoneHash];

  // Name (optional but boosts match rate)
  const fn = sha256Hex(order.customer?.first_name || order.shipping_address?.first_name || order.billing_address?.first_name);
  if (fn) ud.fn = [fn];
  const ln = sha256Hex(order.customer?.last_name || order.shipping_address?.last_name || order.billing_address?.last_name);
  if (ln) ud.ln = [ln];

  // City / region / zip / country (raw, non-hashed for these per Meta spec)
  const addr = order.shipping_address || order.billing_address;
  if (addr) {
    const ct = sha256Hex(addr.city);
    if (ct) ud.ct = [ct];
    const st = sha256Hex(addr.province_code || addr.province);
    if (st) ud.st = [st];
    const zp = sha256Hex(addr.zip);
    if (zp) ud.zp = [zp];
    const country = sha256Hex(addr.country_code || addr.country);
    if (country) ud.country = [country];
  }

  // Browser identity — fbp/fbc must come from cart attributes (note_attributes)
  // captured on /go before the buyer leaves our domain for shop.app/Shopify.
  const attrs = order.note_attributes || [];
  const fbp = attrs.find((a) => a?.name === "fbp")?.value;
  const fbc = attrs.find((a) => a?.name === "fbc")?.value;
  if (fbp) ud.fbp = fbp;
  if (fbc) ud.fbc = fbc;

  // Client details — IP + UA boost match-quality when fbp/fbc are missing.
  if (order.client_details?.browser_ip) ud.client_ip_address = order.client_details.browser_ip;
  if (order.client_details?.user_agent) ud.client_user_agent = order.client_details.user_agent;

  return ud;
}

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeNumber(value: string | number | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function buildClientId(order: ShopifyOrder) {
  const baseId = String(order.id || order.order_number || Date.now());
  const createdAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
  const seconds = Math.max(1, Math.floor(createdAt / 1000));
  return `${baseId}.${seconds}`;
}

function verifyShopifySignature(rawBody: string, signature: string | null) {
  if (!SHOPIFY_WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  return digest === signature;
}

export async function POST(req: Request) {
  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) {
    return json({ ok: false, error: "GA4 API secret or measurement ID missing." }, 500);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifySignature(rawBody, signature)) {
    return json({ ok: false, error: "Invalid Shopify webhook signature." }, 401);
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return json({ ok: false, error: "Invalid JSON payload." }, 400);
  }

  const currency = order.currency || order.presentment_currency || "USD";
  const total =
    safeNumber(order.current_total_price) || safeNumber(order.total_price);
  const tax = safeNumber(order.current_total_tax) || safeNumber(order.total_tax);
  const shipping =
    safeNumber(order.total_shipping_price_set?.shop_money?.amount) ||
    safeNumber(order.total_shipping_price);
  const transactionId = String(order.id || order.order_number || order.name || "");
  const coupon = order.discount_codes?.[0]?.code;

  const items =
    order.line_items?.map((item) => {
      const price = safeNumber(item.price);
      return {
        item_id: String(item.variant_id || item.product_id || item.sku || item.id || item.title),
        item_name: String(item.title || "USA Gummies"),
        item_variant: item.variant_title || undefined,
        item_brand: "USA Gummies",
        item_category: "Gummy Bears",
        price: Number.isFinite(price) && price > 0 ? Number(price.toFixed(2)) : undefined,
        quantity: Math.max(1, Number(item.quantity ?? 1)),
      };
    }) || [];

  const payload = {
    client_id: buildClientId(order),
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: transactionId,
          currency,
          value: Number.isFinite(total) ? Number(total.toFixed(2)) : undefined,
          tax: Number.isFinite(tax) ? Number(tax.toFixed(2)) : undefined,
          shipping: Number.isFinite(shipping) ? Number(shipping.toFixed(2)) : undefined,
          coupon: coupon || undefined,
          items,
          event_id: transactionId || undefined,
        },
      },
    ],
  };

  const res = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const error = await res.text().catch(() => "GA4 request failed.");
    return json({ ok: false, error }, 502);
  }

  // ── Meta Conversions API (CAPI) — server-side purchase event ──
  // Fires alongside GA4 MP so Meta gets server-side conversion data
  // even when client-side pixel is blocked (iOS 14.5+, ad blockers).
  // Requires META_CAPI_ACCESS_TOKEN env var to be set.
  //
  // event_id MUST be deterministic (`pu_${tid}`) so it dedups against the
  // browser-side `fbq("track","Purchase",{event_id})` fire from
  // /thank-you's PurchaseTracker. Mismatched event_ids cause Meta to
  // count both fires as separate purchases, inflating attribution and
  // confusing the optimizer.
  if (META_CAPI_ACCESS_TOKEN) {
    const capiEventId = `pu_${transactionId}`;
    const userData = buildMetaUserData(order);
    const capiPayload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: capiEventId,
          event_source_url: "https://www.usagummies.com/thank-you",
          action_source: "website",
          user_data: userData,
          custom_data: {
            currency,
            value: Number.isFinite(total) ? Number(total.toFixed(2)) : 0,
            content_ids: items.map((i) => i.item_id),
            content_type: "product",
            num_items: items.reduce((sum, i) => sum + i.quantity, 0),
            order_id: transactionId,
          },
        },
      ],
    };

    fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capiPayload),
      },
    ).catch(() => {});
  }

  return json({ ok: true });
}
