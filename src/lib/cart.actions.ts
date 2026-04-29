// src/lib/cart.actions.ts
//
// Cookie-bound cart server actions. Every export is an async server
// action — top-level "use server" makes the file safe to import from
// client components without dragging next/headers into the client
// bundle. Pure helpers (GraphQL, types, getCartById) live in
// `src/lib/cart.ts`.
"use server";

import { cookies } from "next/headers";
import {
  CART_COOKIE,
  CART_CREATE,
  CART_GET,
  CART_LINES_ADD,
  CART_LINES_UPDATE,
  getCartById,
  shopify,
  shopifyResult,
  type CartCreateResult,
  type CartGetResult,
  type CartLinesAddResult,
  type CartLinesUpdateResult,
} from "./cart";
import { normalizeSingleBagVariant } from "@/lib/bundles/atomic";
import { normalizeCheckoutUrl } from "@/lib/checkout";

async function createCartId(): Promise<string> {
  const result = await shopifyResult<CartCreateResult>(CART_CREATE);
  if (!result.ok) {
    throw new Error(result.error || "Cart create failed.");
  }

  const cart = result.data?.cartCreate?.cart;
  const errs = result.data?.cartCreate?.userErrors;
  if (errs?.length) {
    const message = errs.map((err) => err.message).filter(Boolean).join("; ");
    throw new Error(message || "Cart create failed.");
  }
  if (!cart?.id) {
    throw new Error("Cart create failed.");
  }

  const jar = await cookies();
  jar.set(CART_COOKIE, cart.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  });

  return cart.id;
}

async function getOrCreateCartId({
  throwOnError = false,
}: {
  throwOnError?: boolean;
} = {}): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;
  try {
    return await createCartId();
  } catch (err) {
    if (throwOnError) throw err;
    return null;
  }
}

export async function getCart() {
  const jar = await cookies();
  const cartId = jar.get(CART_COOKIE)?.value;
  if (!cartId) return null;

  return getCartById(cartId);
}

export async function addToCart(variantId: string, quantity: number) {
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be added to cart.");
  }
  const cartId = await getOrCreateCartId({ throwOnError: true });
  if (!cartId) {
    throw new Error("Cart unavailable.");
  }

  const result = await shopifyResult<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity }],
  });
  if (!result.ok) {
    throw new Error(result.error || "Cart add failed.");
  }

  const errs = result.data?.cartLinesAdd?.userErrors;
  if (errs?.length) {
    const message = errs.map((err) => err.message).filter(Boolean).join("; ");
    throw new Error(message || "Cart add failed.");
  }

  const cart = result.data?.cartLinesAdd?.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
    });
    return cart.id;
  }
  throw new Error("Cart unavailable.");
}

export async function buyNow(variantId: string, quantity: number) {
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be purchased.");
  }
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  const result = await shopifyResult<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity }],
  });
  if (!result.ok) return null;

  const errs = result.data?.cartLinesAdd?.userErrors;
  if (errs?.length) return null;

  const cart = result.data?.cartLinesAdd?.cart;
  if (!cart?.checkoutUrl) return null;
  const normalized = normalizeCheckoutUrl(cart.checkoutUrl);
  return normalized ?? cart.checkoutUrl;
}

export async function updateLineQuantity(lineId: string, quantity: number) {
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  const nextQty = Math.max(0, Math.min(99, quantity));

  const data = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity: nextQty }],
  });

  const errs = data?.cartLinesUpdate?.userErrors;
  if (errs?.length) return null;

  const cart = data?.cartLinesUpdate?.cart;
  if (cart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, cart.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
    });
    return cart.id;
  }
  return null;
}

/**
 * AOV lever: replace cart contents with ONE specific variant by zeroing
 * existing lines, then adding the new one.
 */
export async function replaceCartWithVariant(variantId: string, quantity: number) {
  const safeVariantId = normalizeSingleBagVariant(variantId);
  if (!safeVariantId) {
    throw new Error("Only the single-bag variant can be used for bundles.");
  }
  const cartId = await getOrCreateCartId();
  if (!cartId) return null;

  const data = await shopify<CartGetResult>(CART_GET, { cartId });
  const cart = data?.cart;

  const lineUpdates =
    cart?.lines?.edges?.map((e) => ({ id: e.node.id, quantity: 0 })) ?? [];

  if (lineUpdates.length) {
    const cleared = await shopify<CartLinesUpdateResult>(CART_LINES_UPDATE, {
      cartId,
      lines: lineUpdates,
    });

    const errs = cleared?.cartLinesUpdate?.userErrors;
    if (errs?.length) return null;
  }

  const nextQty = Math.max(1, Math.min(99, Number(quantity) || 1));
  const added = await shopify<CartLinesAddResult>(CART_LINES_ADD, {
    cartId,
    lines: [{ merchandiseId: safeVariantId, quantity: nextQty }],
  });

  const errs2 = added?.cartLinesAdd?.userErrors;
  if (errs2?.length) return null;

  const nextCart = added?.cartLinesAdd?.cart;
  if (nextCart?.id) {
    const jar = await cookies();
    jar.set(CART_COOKIE, nextCart.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
    });
    return nextCart.id;
  }
  return null;
}
