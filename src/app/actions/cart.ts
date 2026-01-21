// src/app/actions/cart.ts (FULL REPLACE)
"use server";

import { redirect } from "next/navigation";
import {
  addToCart as addLine,
  buyNow as buyNowInternal,
  updateLineQuantity,
  replaceCartWithVariant,
  getCart as getCartInternal,
} from "@/lib/cart";
import { normalizeSingleBagVariant } from "@/lib/bundles/atomic";
import { getSafeCheckoutUrl } from "@/lib/checkout";

/**
 * Server actions wrapper layer.
 *
 * Design goal: make cart UX components resilient.
 * - All Shopify cart mutations live in src/lib/cart.ts.
 * - UI components call these actions (FormData) or the REST fallback (/api/cart).
 */

export async function getCart() {
  return getCartInternal();
}

export async function addToCart(formData: FormData) {
  const variantId = String(formData.get("merchandiseId") ?? "");
  const safeVariantId = normalizeSingleBagVariant(variantId);
  const quantity = Math.max(1, Number(formData.get("quantity") ?? 1) || 1);
  if (!safeVariantId) throw new Error("Invalid merchandiseId (variant id).");
  try {
    await addLine(safeVariantId, quantity);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Cart add failed." };
  }
}

export async function buyNow(formData: FormData) {
  const variantId = String(formData.get("merchandiseId") ?? "");
  const safeVariantId = normalizeSingleBagVariant(variantId);
  const quantity = Math.max(1, Number(formData.get("quantity") ?? 1) || 1);
  if (!safeVariantId) throw new Error("Invalid merchandiseId (variant id).");
  const checkoutUrl = await buyNowInternal(safeVariantId, quantity);
  if (!checkoutUrl) {
    redirect("/cart");
  }
  const safeCheckoutUrl = getSafeCheckoutUrl(checkoutUrl, "buy_now_action");
  if (!safeCheckoutUrl) {
    return { ok: false, error: "Invalid checkout URL." };
  }
  redirect(safeCheckoutUrl);
}

export async function updateLine(formData: FormData) {
  const lineId = String(formData.get("lineId") ?? "");
  const quantity = Math.max(0, Number(formData.get("quantity") ?? 0) || 0);
  if (!lineId) throw new Error("Missing lineId.");
  await updateLineQuantity(lineId, quantity);
  return { ok: true };
}

export async function removeLine(formData: FormData) {
  const lineId = String(formData.get("lineId") ?? "");
  if (!lineId) throw new Error("Missing lineId.");
  await updateLineQuantity(lineId, 0);
  return { ok: true };
}

/**
 * Bundle ladder AOV lever: clear cart then add one variant.
 */
export async function replaceWithVariant(formData: FormData) {
  const variantId = String(formData.get("merchandiseId") ?? "");
  const safeVariantId = normalizeSingleBagVariant(variantId);
  const quantity = Math.max(1, Number(formData.get("quantity") ?? 1) || 1);
  if (!safeVariantId) throw new Error("Invalid merchandiseId (variant id).");
  await replaceCartWithVariant(safeVariantId, quantity);
  return { ok: true };
}

export async function goToCheckout() {
  const cart = await getCartInternal();
  if (!cart || !cart.checkoutUrl) redirect("/");
  const safeCheckoutUrl = getSafeCheckoutUrl(cart.checkoutUrl, "go_to_checkout");
  if (!safeCheckoutUrl) {
    return { ok: false, error: "Invalid checkout URL." };
  }
  redirect(safeCheckoutUrl);
}
