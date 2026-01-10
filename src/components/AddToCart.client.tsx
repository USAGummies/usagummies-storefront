"use client";

import { normalizeSingleBagVariant, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

export default function AddToCart({ variantId }: { variantId: string }) {
  const targetVariantId = normalizeSingleBagVariant(variantId) || SINGLE_BAG_VARIANT_ID;

  async function handleClick() {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: targetVariantId }),
    });

    const data = await res.json();
    window.location.href = data.checkoutUrl;
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
