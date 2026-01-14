"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { pricingForQty, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

const QUICK_QTYS = [1, 2, 3, 4, 5, 8, 12];

type QuickViewProps = {
  product: any;
  detailHref: string;
  bundleHref: string;
  children?: (open: () => void) => React.ReactNode;
};

function money(amount?: number, currencyCode = "USD") {
  if (!Number.isFinite(amount ?? NaN)) return "—";
  const n = amount as number;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

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

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

export default function QuickView({ product, detailHref, bundleHref, children }: QuickViewProps) {
  const [open, setOpen] = useState(false);
  const [selectedQty, setSelectedQty] = useState(8);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const img = product?.featuredImage;
  const description = product?.description || "";
  const pricing = pricingForQty(selectedQty);
  const total = pricing.total;
  const perBag = pricing.perBag;
  const freeShip = selectedQty >= 5;

  async function addToCart() {
    setError(null);
    setAdding(true);
    try {
      const storedCartId = getStoredCartId();
      if (storedCartId && typeof document !== "undefined") {
        document.cookie = `cartId=${storedCartId}; path=/; samesite=lax`;
      }
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          variantId: SINGLE_BAG_VARIANT_ID,
          merchandiseId: SINGLE_BAG_VARIANT_ID,
          quantity: selectedQty,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Cart request failed");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || "Could not add to cart.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      {children ? (
        children(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-[var(--navy)] underline underline-offset-4 hover:text-[var(--text)]"
        >
          Quick view
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="mx-auto w-full max-w-2xl rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(15,27,45,0.25)] sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--text)]">Quick view</div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)] hover:bg-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.2fr]">
              <div className="relative aspect-square overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)]">
                {img?.url ? (
                  <Image
                    src={img.url}
                    alt={img.altText || product?.title || "USA Gummies"}
                    fill
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
                    No image
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-black text-[var(--text)]">
                  {product?.title || "USA Gummies"}
                </h3>
                <p className="text-sm text-[var(--muted)] line-clamp-6">
                  {description || "See the product page for full ingredients and nutrition details."}
                </p>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Pick a bundle
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-8 bg-gradient-to-r from-[var(--surface)] to-transparent" />
                    <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-[var(--surface)] to-transparent" />
                    <div className="bundle-slider flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
                      {QUICK_QTYS.map((qty) => {
                        const tierPricing = pricingForQty(qty);
                        const totalPrice = money(tierPricing.total);
                        const perBagPrice = money(tierPricing.perBag);
                        const isActive = qty === selectedQty;
                        const highlight = qty === 8;
                        return (
                          <button
                            key={qty}
                            type="button"
                            onClick={() => setSelectedQty(qty)}
                            className={[
                              "snap-start rounded-2xl border px-3 py-2 text-left text-xs font-semibold",
                              "min-w-[150px] bg-[var(--surface-strong)]",
                              isActive
                                ? "border-[rgba(199,160,98,0.7)] shadow-[0_12px_28px_rgba(15,27,45,0.18)]"
                                : "border-[var(--border)]",
                              highlight ? "bg-[rgba(13,28,51,0.06)]" : "",
                            ].join(" ")}
                            aria-pressed={isActive}
                          >
                            <div className="text-sm font-black text-[var(--text)]">{qty} bags</div>
                            <div className="mt-1 text-[var(--muted)]">{totalPrice}</div>
                            <div className="text-[11px] text-[var(--muted)]">~{perBagPrice} / bag</div>
                            <div className="mt-1 text-[10px] text-[var(--muted)]">
                              {qty >= 5 ? FREE_SHIPPING_PHRASE : "Standard price"}
                            </div>
                            {qty === 8 ? (
                              <div className="mt-1 inline-flex rounded-full border border-[rgba(199,160,98,0.6)] bg-[rgba(199,160,98,0.18)] px-2 py-0.5 text-[10px] font-semibold text-[var(--gold)]">
                                Best value
                              </div>
                            ) : null}
                            {qty === 5 ? (
                              <div className="mt-1 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text)]">
                                Most popular
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      Selected: {selectedQty} bags
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[var(--muted)]">Total</div>
                      <div className="text-lg font-black text-[var(--text)] price-pop">
                        {money(total)}
                      </div>
                      <div className="text-xs text-[var(--muted)]">~{money(perBag)} / bag</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {freeShip ? FREE_SHIPPING_PHRASE : "Standard shipping rates apply"}
                  </div>

                  {error ? <div className="mt-2 text-xs text-[var(--red)]">{error}</div> : null}

                  <button
                    type="button"
                    onClick={addToCart}
                    disabled={adding}
                    className="btn btn-red mt-3 w-full"
                  >
                    {adding
                      ? "Adding…"
                      : `Add ${selectedQty}-bag bundle — ${money(total)} →`}
                  </button>
                  <div className="mt-2 text-[11px] text-[var(--muted)]">Free shipping • Secure checkout</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link href={detailHref} className="btn btn-outline">
                    View full details
                  </Link>
                  <Link href={bundleHref} className="btn btn-navy">
                    Jump to bundles
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
