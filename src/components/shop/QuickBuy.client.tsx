"use client";

import * as React from "react";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { fireCartToast } from "@/lib/cartFeedback";

type AnyProduct = any;

function storeCartId(cartId?: string | null) {
  if (!cartId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cartId", cartId);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") {
    document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
  }
}

function getVariants(product: AnyProduct): AnyProduct[] {
  return (
    product?.variants?.nodes ||
    product?.variants?.edges?.map((e: any) => e?.node) ||
    []
  );
}

function getFirstVariantId(product: AnyProduct): string | null {
  const variants = getVariants(product);
  const v0 = variants?.[0];
  return (
    v0?.id ||
    v0?.variantId ||
    v0?.merchandiseId ||
    null
  );
}

/**
 * QuickBuy
 * - Client component that can call a Server Action via <form action={...}>
 * - Accepts `product` and adds first variant by default
 */
export default function QuickBuy({
  product,
  campaign,
}: {
  product: AnyProduct;
  campaign?: string | null;
}) {
  const variantId = SINGLE_BAG_VARIANT_ID || getFirstVariantId(product);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // If product is missing variants (or Shopify returned something unexpected),
  // don't hard-crash the UI.
  if (!variantId) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm font-semibold text-[var(--muted)] opacity-60"
        title="No purchasable variant found"
      >
        Unavailable
      </button>
    );
  }

  async function handleAdd() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId,
          quantity: 1,
          campaign: campaign || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Add failed");
      if (json?.cart?.id) storeCartId(json.cart.id);
      window.dispatchEvent(new Event("cart:updated"));
      fireCartToast(1);
    } catch (e: any) {
      setError(e?.message || "Could not add");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleAdd}
        disabled={pending}
        className={[
          "inline-flex items-center justify-center rounded-2xl",
          "border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm font-semibold text-[var(--text)]",
          "transition-colors hover:bg-white",
          "disabled:cursor-not-allowed disabled:opacity-60",
        ].join(" ")}
      >
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
            />
            Adding…
          </span>
        ) : (
          "Quick add"
        )}
      </button>
      {error ? <span className="text-[11px] text-red-200">{error}</span> : null}
    </div>
  );
}
