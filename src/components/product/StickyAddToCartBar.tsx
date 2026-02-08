// src/components/product/StickyAddToCartBar.tsx (FULL REPLACE)
"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE_PRICE, pricingForQty } from "@/lib/bundles/pricing";
import { normalizeCheckoutUrl } from "@/lib/checkout";
import { trackEvent } from "@/lib/analytics";

type Props = {
  title: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  buttonLabel?: string;
  source?: "home" | "shop";
  className?: string;
  containerClassName?: string;
};

type CartLine = {
  quantity?: number;
  merchandise?: any;
};

function formatMoney(amount: number, currency = "USD") {
  if (!Number.isFinite(amount)) return "$0.00";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function parseBagsFromTitle(title?: string): number | undefined {
  const t = (title || "").toLowerCase();
  if (t.includes("single")) return 1;
  const m = t.match(/(\d+)\s*(?:bag|bags)\b/);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  const fallback = t.match(/(\d+)/);
  if (fallback?.[1]) {
    const n = Number(fallback[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function getBagsPerUnit(merchandise: any): number {
  const meta =
    merchandise?.bundleQty?.value ??
    merchandise?.bundleBags?.value ??
    merchandise?.metafield?.value;
  const metaNum = Number(meta);
  if (Number.isFinite(metaNum) && metaNum > 0) return metaNum;
  const parsed = parseBagsFromTitle(merchandise?.title);
  if (parsed && parsed > 0) return parsed;
  return 1;
}

function getTotalBags(cart: any) {
  const lines: CartLine[] =
    cart?.lines?.nodes ??
    cart?.lines?.edges?.map((e: any) => e?.node) ??
    [];
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => {
    const bagsPerUnit = getBagsPerUnit(line?.merchandise);
    const qty = Number(line?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
}

export function StickyAddToCartBar({
  title,
  imageUrl,
  imageAlt,
  buttonLabel = "Checkout",
  source = "shop",
  className,
  containerClassName,
}: Props) {
  const [cart, setCart] = useState<any>(null);
  const alt = useMemo(
    () => imageAlt || (title ? `Product photo of ${title}` : "Product photo"),
    [imageAlt, title]
  );

  const refreshCart = useCallback(() => {
    const cartId =
      typeof window !== "undefined" ? window.localStorage.getItem("cartId") : null;
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
    })
      .then((res) => res.json())
      .then((data) => {
        const nextCart = data?.cart ?? null;
        if (nextCart?.id && typeof window !== "undefined") {
          window.localStorage.setItem("cartId", nextCart.id);
          if (typeof document !== "undefined") {
            document.cookie = `cartId=${nextCart.id}; path=/; samesite=lax`;
          }
        }
        setCart(nextCart);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => refreshCart();
    window.addEventListener("cart:updated", handler);
    return () => window.removeEventListener("cart:updated", handler);
  }, [refreshCart]);

  const totalBags = getTotalBags(cart);
  const currency = cart?.cost?.subtotalAmount?.currencyCode || "USD";
  const bundlePricing = totalBags > 0 ? pricingForQty(totalBags) : null;
  const totalAmount = bundlePricing
    ? bundlePricing.total
    : Number(cart?.cost?.subtotalAmount?.amount ?? 0);
  const savings = bundlePricing
    ? Math.max(0, BASE_PRICE * totalBags - bundlePricing.total)
    : 0;
  const totalText = totalBags > 0 ? formatMoney(totalAmount, currency) : "";
  const savingsText = formatMoney(savings, currency);
  const bagLabel = totalBags === 1 ? "1 bag" : `${totalBags} bags`;
  const checkoutHref = useMemo(
    () => normalizeCheckoutUrl(cart?.checkoutUrl) ?? cart?.checkoutUrl ?? "/cart",
    [cart?.checkoutUrl]
  );

  if (totalBags <= 0) return null;

  function handleCheckout() {
    trackEvent("sticky_checkout_click", { source });
  }

  return (
    <div className={`fixed inset-x-0 bottom-0 z-50 ${className || ""}`}>
      <div
        className={`mx-auto w-full max-w-6xl px-3 pb-3 ${containerClassName || ""}`}
        style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white/95 px-3 py-2 shadow-[0_16px_36px_rgba(15,27,45,0.12)] backdrop-blur-md">
          {imageUrl ? (
            <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]">
              <Image
                src={imageUrl}
                alt={alt}
                fill
                sizes="40px"
                className="object-cover"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
              {title}
            </div>
            <div className="text-sm font-semibold text-[var(--text)] truncate">
              {bagLabel} • {totalText}
            </div>
            <div className="text-xs text-[var(--muted)]">You save {savingsText}</div>
          </div>
          <a
            href={checkoutHref}
            onClick={handleCheckout}
            className="btn btn-candy pressable"
            style={{ whiteSpace: "nowrap" }}
          >
            {buttonLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
