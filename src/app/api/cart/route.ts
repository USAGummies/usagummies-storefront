// src/app/api/cart/route.ts
import { NextResponse } from "next/server";
import {
  addToCart,
  buyNow,
  updateLineQuantity,
  replaceCartWithVariant,
  getCart,
  getCartById,
} from "@/lib/cart";
import { normalizeSingleBagVariant } from "@/lib/bundles/atomic";

type Body = {
  action?: "add" | "buy" | "update" | "replace" | "get";
  variantId?: string;
  quantity?: number;
  lineId?: string;
};

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const action = body.action ?? "buy";

  try {
    if (action === "get") {
      const cart = await getCart();
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
