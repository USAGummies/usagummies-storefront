export type CartToastDetail = {
  qty: number;
};

import { MIN_PER_BAG } from "@/lib/bundles/pricing";

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
  if (qty === 8) return "8 bags added — great choice. This is our most popular bundle.";
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
  window.dispatchEvent(new CustomEvent<CartToastDetail>("cart:toast", { detail: { qty } }));
}
