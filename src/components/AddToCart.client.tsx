"use client";

import { normalizeSingleBagVariant, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { getSafeCheckoutUrl } from "@/lib/checkout";

export default function AddToCart({ variantId }: { variantId: string }) {
  const targetVariantId = normalizeSingleBagVariant(variantId) || SINGLE_BAG_VARIANT_ID;

  async function handleClick() {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: targetVariantId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false || !data?.checkoutUrl) {
      console.error("[checkout] Buy now failed.", {
        status: res.status,
        error: data?.error,
      });
      return;
    }
    const safeCheckoutUrl = getSafeCheckoutUrl(
      data.checkoutUrl,
      "buy_now_button",
      typeof window !== "undefined" ? window.location.host : undefined
    );
    if (!safeCheckoutUrl) return;
    window.location.href = safeCheckoutUrl;
  }

  return (
    <button
      onClick={handleClick}
      style={{
        padding: "1rem 2rem",
        fontSize: "1rem",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Buy Now
    </button>
  );
}
