"use client";

import { useEffect, useState } from "react";
import { useCartBagCount } from "@/hooks/useCartBagCount";

/**
 * Sticky mobile CTA that nudges users without items in cart to scroll
 * up and shop. Only shows on mobile, only when cart is empty, and only
 * after scrolling past the bundle section.
 */
export default function StickyShopCTA() {
  const { bagCount } = useCartBagCount();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Find the bundle CTA anchor
    const anchor =
      document.getElementById("hero-primary-cta") ||
      document.getElementById("bundle-pricing");
    if (!anchor) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show when bundle section is scrolled out of view
        setShow(!entry.isIntersecting);
      },
      { rootMargin: "-100px 0px 0px 0px", threshold: 0 }
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);

  // Don't show if cart has items (the StickyAddToCartBar handles that)
  const hasItems = (Number(bagCount) || 0) > 0;
  if (!show || hasItems) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 block sm:hidden animate-in slide-in-from-bottom-4 duration-300"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-lg px-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(15,27,45,0.10)] bg-white/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-[var(--text)] truncate">
              Free shipping on 5+ bags
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              ⭐ 4.8 stars · Made in USA
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const el =
                document.getElementById("hero-primary-cta") ||
                document.getElementById("bundle-pricing");
              if (el) {
                const prefersReduced =
                  window.matchMedia?.("(prefers-reduced-motion: reduce)")
                    .matches ?? false;
                el.scrollIntoView({
                  behavior: prefersReduced ? "auto" : "smooth",
                  block: "start",
                });
              }
            }}
            className="btn btn-candy shrink-0 px-4 py-2.5 text-sm font-black"
          >
            Shop & save
          </button>
        </div>
      </div>
    </div>
  );
}
