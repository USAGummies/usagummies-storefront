export type CartToastDetail = {
  qty: number;
};

import { MIN_PER_BAG } from "@/lib/bundles/pricing";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

const LAST_ADD_KEY = "cart:lastAdd";

export type LastAddInfo = {
  qty: number;
  at: number;
  variantId: string;
};

function formatMoney(amount: number) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function getCartToastMessage(qty: number) {
  if (!Number.isFinite(qty) || qty <= 0) return "Added to cart.";
  if (qty > 12) {
    return `${qty} bags added — per-bag price capped at ${formatMoney(MIN_PER_BAG)}.`;
  }
  if (qty === 12) return "12 bags added — best price per bag.";
  if (qty === 8) return "8 bags added — great choice. This is our most popular size.";
  if (qty >= 5) return "Added to cart. Want better value? Most customers choose 8 bags.";
  if (qty === 4) return "4 bags added. Add 1 more bag for free shipping.";
  if (qty >= 1 && qty <= 3) {
    const needed = 4 - qty;
    return `Added to cart. Add ${needed} more bag${needed === 1 ? "" : "s"} to start saving.`;
  }
  return "Added to cart.";
}

export function fireCartToast(qty: number) {
  if (typeof window === "undefined") return;
  if (Number.isFinite(qty) && qty > 0) {
    try {
      const payload: LastAddInfo = {
        qty,
        at: Date.now(),
        variantId: SINGLE_BAG_VARIANT_ID,
      };
      window.localStorage.setItem(LAST_ADD_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
  }
  window.dispatchEvent(new CustomEvent<CartToastDetail>("cart:toast", { detail: { qty } }));
}

export function readLastAdd(): LastAddInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_ADD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastAddInfo;
    if (!parsed || !Number.isFinite(parsed.qty) || !Number.isFinite(parsed.at)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
