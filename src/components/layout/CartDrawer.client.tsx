"use client";

import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/ui/Glass";
import { CartView } from "@/components/ui/CartView";
import { cn } from "@/lib/cn";

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [cart, setCart] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/cart", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get" }),
    })
      .then((r) => r.json())
      .then((data) => setCart(data.cart ?? null))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    function refresh() {
      fetch("/api/cart", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
      })
        .then((r) => r.json())
        .then((data) => setCart(data.cart ?? null))
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
          <GlassPanel className="h-full rounded-none border-l border-[var(--border)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div className="text-lg font-black text-white">Your cart</div>
              <button
                type="button"
                onClick={onClose}
                className="pressable rounded-full border border-[var(--border)] px-3 py-1 text-sm text-white focus-ring"
              >
                Close
              </button>
            </div>
            <div className="h-[calc(100%-64px)] overflow-y-auto">
              <CartView cart={cart} onClose={onClose} />
            </div>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
