"use client";

import { useEffect } from "react";

export default function FocusBundles({
  targetSelector,
}: {
  targetSelector: string;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const focus = url.searchParams.get("focus");

    if (focus !== "bundles") return;
    const prefersReduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Give the page a tick to render before we scroll/highlight
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(targetSelector);
      if (!el) return;

      el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });

      // Gold flash ring + glow
      const flashClass =
        "ring-2 ring-[#d4af37] shadow-[0_0_0_1px_rgba(212,175,55,0.30),0_0_42px_rgba(212,175,55,0.22)]";

      if (!prefersReduced) {
        el.classList.add("transition-all", "duration-300");
      }
      el.classList.add(flashClass);

      // Add a quick pulse using Web Animations API (no tailwind config needed)
      if (!prefersReduced) {
        try {
          el.animate(
            [
              { transform: "translateY(0px)", offset: 0 },
              { transform: "translateY(-2px)", offset: 0.35 },
              { transform: "translateY(0px)", offset: 1 },
            ],
            { duration: 900, easing: "ease-in-out" }
          );
        } catch {
          // safe ignore
        }
      }

      // Remove highlight after a moment
      window.setTimeout(() => {
        el.classList.remove(flashClass);
      }, 1400);

      // Clean URL so refresh doesn’t keep re-triggering
      url.searchParams.delete("focus");
      window.history.replaceState({}, "", url.toString());
    }, 200);

    return () => window.clearTimeout(t);
  }, [targetSelector]);

  return null;
}
