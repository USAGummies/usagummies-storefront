// src/app/api/cart/route.ts
import { NextResponse } from "next/server";
import {
  addToCart,
  buyNow,
  updateLineQuantity,
  replaceCartWithVariant,
  getCart,
  getCartById,
  getCartConfigStatus,
} from "@/lib/cart";
import { normalizeSingleBagVariant } from "@/lib/bundles/atomic";

/* ── In-memory rate limiter (resets on cold start — acceptable on Vercel) ── */
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
const RATE_LIMIT_MAX = 30; // max requests per window per IP

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}
/* ── End rate limiter ── */

type Body = {
  action?: "add" | "buy" | "update" | "replace" | "get";
  variantId?: string;
  quantity?: number;
  lineId?: string;
  cartId?: string;
};

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return json({ ok: false, error: "Too many requests. Please try again later." }, 429);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const action = body.action ?? "buy";
  const config = getCartConfigStatus();
  if (!config.endpoint || !config.token) {
    return json(
      {
        ok: false,
        error:
          "Shopify Storefront API is not configured. Set SHOPIFY_STOREFRONT_API_ENDPOINT and SHOPIFY_STOREFRONT_API_TOKEN in Vercel.",
      },
      500
    );
  }

  try {
    if (action === "get") {
      const cartId = String(body.cartId ?? "");
      const cart =
        cartId ? (await getCartById(cartId)) ?? (await getCart()) : await getCart();
      return json({ ok: true, cart });
    }

    if (action === "update") {
      const lineId = String(body.lineId ?? "");
      const quantity = Math.max(0, Number(body.quantity ?? 0) || 0);
      if (!lineId) return json({ ok: false, error: "Missing lineId." }, 400);
      const cartId = await updateLineQuantity(lineId, quantity);
      if (!cartId) return json({ ok: false, error: "Cart update failed." }, 500);
      const cart = await getCartById(cartId);
      if (!cart) return json({ ok: false, error: "Cart unavailable." }, 500);
      return json({ ok: true, cart });
    }

    if (action === "replace") {
      const variantId = String(body.variantId ?? "");
      const quantity = Math.max(1, Number(body.quantity ?? 1) || 1);
      const safeVariantId = normalizeSingleBagVariant(variantId);
      if (!safeVariantId)
        return json({ ok: false, error: "Invalid variantId." }, 400);
      const cartId = await replaceCartWithVariant(safeVariantId, quantity);
      if (!cartId) return json({ ok: false, error: "Cart replace failed." }, 500);
      const cart = await getCartById(cartId);
      if (!cart) return json({ ok: false, error: "Cart unavailable." }, 500);
      return json({ ok: true, cart });
    }

    // add/buy
    const variantId = String(body.variantId ?? "");
    const quantity = Math.max(1, Number(body.quantity ?? 1) || 1);
    const safeVariantId = normalizeSingleBagVariant(variantId);
    if (!safeVariantId)
      return json({ ok: false, error: "Invalid variantId." }, 400);

    if (action === "add") {
      const cartId = await addToCart(safeVariantId, quantity);
      if (!cartId) return json({ ok: false, error: "Cart add failed." }, 500);
      const cart = await getCartById(cartId);
      if (!cart) return json({ ok: false, error: "Cart unavailable." }, 500);
      return json({ ok: true, cart });
    }

    // default: buy
    const checkoutUrl = await buyNow(safeVariantId, quantity);
    if (!checkoutUrl)
      return json({ ok: false, error: "Checkout unavailable." }, 500);
    return json({ ok: true, checkoutUrl });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Cart API error" }, 500);
  }
}
