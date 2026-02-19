"use client";

import { useEffect, useRef, useState } from "react";
import { CartView } from "@/components/ui/CartView";
import { cn } from "@/lib/cn";
import { getStoredCartId, storeCartId } from "@/lib/cartClientUtils";

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [cart, setCart] = useState<any>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

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
    function refresh() {
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

  // Focus trap: trap Tab/Shift+Tab within the drawer
  useEffect(() => {
    if (!open || !drawerRef.current) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector);
    const firstFocusable = focusableElements[0];

    if (firstFocusable) {
      firstFocusable.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const currentFocusables = drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!currentFocusables || currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!mounted || !open) return null;

  return (
    <>
      <div
        ref={drawerRef}
        className="fixed inset-0 z-50 flex justify-end md:justify-center"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
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
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
              <div className="text-lg font-black text-[var(--text)]">Your cart</div>
              <button
                type="button"
                onClick={onClose}
                className="pressable rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--text)] focus-ring"
              >
                Close
              </button>
            </div>
            <div className="h-[calc(100%-64px)] overflow-y-auto">
              <CartView cart={cart} onClose={onClose} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
