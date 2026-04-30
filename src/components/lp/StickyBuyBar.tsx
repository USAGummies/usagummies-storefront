"use client";

// Sticky mobile buy bar — keeps the CTA a tap away from the moment users
// arrive. Critical for ad traffic: Instagram WebView users bounce in 1-2
// seconds; they need a visible buy CTA in the first viewport, before they
// scroll. Logic (revised 2026-04-27 from data showing 1-2s bounce on
// Instagram traffic):
//   - On mobile (<768px viewport): show after 1.2s delay regardless of scroll
//   - On desktop / above any-device 50px scroll: show immediately

import Link from "next/link";
import { useEffect, useState } from "react";

export function StickyBuyBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;

    // On mobile, force-show after 1.2 seconds — ad-click visitors need an
    // immediate visible CTA, they bounce too fast to scroll for it.
    let mobileTimer: ReturnType<typeof setTimeout> | null = null;
    if (isMobile) {
      mobileTimer = setTimeout(() => setShow(true), 1200);
    }

    const onScroll = () => {
      // Aggressive low threshold (~50px) — show as soon as any scroll happens.
      setShow(window.scrollY > 50);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (mobileTimer) clearTimeout(mobileTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      className="lp-sticky-buy"
      data-show={show ? "true" : "false"}
      role="region"
      aria-label="Order bar"
    >
      <div className="flex flex-col leading-tight">
        <span className="lp-sticky-text">Buy 4, Get 1 FREE</span>
        <span className="lp-label text-[0.62rem] text-[var(--lp-cream)]/80">
          $23.96 · 5-Pack · Free shipping
        </span>
      </div>
      <Link
        href="/go/checkout?qty=5&utm_source=lp&utm_medium=sticky"
        aria-label="Buy 4 get 1 free — 5-pack for $23.96 with free shipping"
      >
        $23.96 →
      </Link>
    </div>
  );
}
