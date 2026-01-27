import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const GA4_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA4_ID?.trim() || "G-31X673PSVY";
const GA4_API_SECRET = process.env.GA4_API_SECRET?.trim();
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();

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
};

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

  return json({ ok: true });
}
