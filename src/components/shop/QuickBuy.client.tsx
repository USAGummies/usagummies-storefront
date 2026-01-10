"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

type AnyProduct = any;

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

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={[
        "inline-flex items-center justify-center rounded-2xl",
        "border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white",
        "transition-colors hover:bg-white/10",
        "disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
    >
      {pending ? "Adding…" : "Quick add"}
    </button>
  );
}

/**
 * QuickBuy
 * - Client component that can call a Server Action via <form action={...}>
 * - Accepts `product` and adds first variant by default
 */
export default function QuickBuy({
  product,
  addToCartAction,
  campaign,
}: {
  product: AnyProduct;
  addToCartAction: (fd: FormData) => Promise<void>;
  campaign?: string | null;
}) {
  const variantId = SINGLE_BAG_VARIANT_ID || getFirstVariantId(product);

  // If product is missing variants (or Shopify returned something unexpected),
  // don't hard-crash the UI.
  if (!variantId) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 opacity-60"
        title="No purchasable variant found"
      >
        Unavailable
      </button>
    );
  }

  return (
    <form action={addToCartAction}>
      {/* Server action inputs */}
      <input type="hidden" name="merchandiseId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      {campaign ? <input type="hidden" name="campaign" value={campaign} /> : null}

      <SubmitButton />
    </form>
  );
}
