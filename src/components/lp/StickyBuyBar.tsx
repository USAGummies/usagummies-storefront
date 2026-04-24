"use client";

// Sticky mobile buy bar — appears after the user scrolls past the hero.
// Thumb-zone anchored. Keeps the CTA a tap away no matter how deep they scroll.

import Link from "next/link";
import { useEffect, useState } from "react";

export function StickyBuyBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      // Show once the user is past the first viewport-ish of scroll
      const threshold = Math.min(window.innerHeight * 0.8, 620);
      setShow(window.scrollY > threshold);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="lp-sticky-buy"
      data-show={show ? "true" : "false"}
      role="region"
      aria-label="Order bar"
    >
      <div className="flex flex-col leading-tight">
        <span className="lp-sticky-text">All-American Gummy Bears</span>
        <span className="lp-label text-[0.62rem] text-[var(--lp-cream)]/80">
          7.5 oz · Dye-Free · $5.99
        </span>
      </div>
      <Link
        href="/go/checkout?qty=1&utm_source=lp&utm_medium=sticky"
        aria-label="Order a bag for $5.99"
      >
        Order — $5.99
      </Link>
    </div>
  );
}
