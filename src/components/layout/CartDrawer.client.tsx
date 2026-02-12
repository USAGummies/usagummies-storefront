"use client";

import { useEffect, useState } from "react";
import { CartView } from "@/components/ui/CartView";
import { GiftNote } from "@/components/cart/GiftNote.client";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { cn } from "@/lib/cn";

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
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

function getCartBagCount(cart: any): number {
  const lines = cart?.lines?.edges?.map((e: any) => e?.node) ?? [];
  return lines.reduce((sum: number, line: any) => sum + (Number(line?.quantity) || 0), 0);
}

const UPSELL_TIERS = [
  { min: 1, max: 4, message: "Add 1 more bag for free shipping!", target: 5, savings: null },
  { min: 5, max: 7, message: "Upgrade to 8 bags and save $7.73", target: 8, savings: "$7.73" },
  { min: 8, max: 11, message: "Go to 12 bags — best value at $4.25/bag", target: 12, savings: "$13.08" },
];

function CartUpsell({ cart }: { cart: any }) {
  const bags = getCartBagCount(cart);
  if (bags <= 0 || bags >= 12) return null;

  const tier = UPSELL_TIERS.find((t) => bags >= t.min && bags <= t.max);
  if (!tier) return null;

  const progress = Math.min(100, Math.round((bags / 12) * 100));

  return (
    <div className="mx-4 mb-4 rounded-xl border border-[rgba(220,38,38,0.15)] bg-[rgba(220,38,38,0.04)] p-3">
      <div className="flex items-center gap-2 text-[13px] font-bold text-red-700">
        <span>🎉</span>
        <span>{tier.message}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(220,38,38,0.1)]">
        <div
          className="h-full rounded-full bg-red-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{bags} bag{bags === 1 ? "" : "s"} in cart</span>
        <span>12 bags = best value</span>
      </div>
    </div>
  );
}

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [cart, setCart] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const cartId = getStoredCartId();
    fetch("/api/cart", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
    })
      .then((r) => r.json())
      .then((data) => {
        const nextCart = data.cart ?? null;
        if (nextCart?.id) storeCartId(nextCart.id);
        setCart(nextCart);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    function refresh(event: Event) {
      // Use cart data from event if available (avoids stale-ID race condition on mobile)
      const eventCart = (event as CustomEvent<{ cart?: any }>)?.detail?.cart;
      if (eventCart?.id) {
        storeCartId(eventCart.id);
        setCart(eventCart);
        return;
      }
      // Fallback: re-fetch from API
      const cartId = getStoredCartId();
      fetch("/api/cart", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
      })
        .then((r) => r.json())
        .then((data) => {
          const nextCart = data.cart ?? null;
          if (nextCart?.id) storeCartId(nextCart.id);
          setCart(nextCart);
        })
        .catch(() => {});
    }
    window.addEventListener("cart:updated", refresh);
    return () => window.removeEventListener("cart:updated", refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end md:justify-center">
        <div
          className={cn(
            "absolute inset-0 bg-[rgba(0,0,0,0.55)] transition-opacity duration-200 ease-out",
            "opacity-100"
          )}
          onClick={onClose}
          aria-hidden="true"
        />

        <div
          className={cn(
            "relative h-full w-full max-w-lg transform-gpu transition-transform duration-200 ease-out",
            "translate-x-0 opacity-100"
          )}
          aria-hidden={!open}
        >
          <div className="h-full rounded-none border-l border-[var(--border)] bg-[var(--surface)] text-[var(--text)] sm:rounded-l-[var(--radius-xl)] sm:shadow-[var(--shadow-card)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-lg font-black text-[var(--text)]">Your cart</div>
                <button
                  type="button"
                  onClick={onClose}
                  className="pressable rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--text)] focus-ring"
                >
                  Close
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-[var(--muted)]">
                <span>⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers</span>
                <span className="h-2.5 w-px bg-[var(--border)]" aria-hidden="true" />
                <span>🇺🇸 Made in USA</span>
                <span className="h-2.5 w-px bg-[var(--border)]" aria-hidden="true" />
                <span>🏭 FDA-registered facility</span>
              </div>
            </div>
            <div className="h-[calc(100%-64px)] overflow-y-auto">
              <CartView cart={cart} onClose={onClose} />
              {cart?.lines?.edges?.length > 0 && (
                <div className="px-4 pb-4">
                  <GiftNote />
                </div>
              )}
              <CartUpsell cart={cart} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
