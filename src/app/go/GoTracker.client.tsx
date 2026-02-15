"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Client component that attaches click-tracking to the /go landing page CTAs.
 * Uses event delegation so we don't need onClick handlers on the server component.
 *
 * Events fired:
 *   - go_click_5pack        (any /go/checkout link)
 *   - go_click_amazon       (any amazon.com outbound link)
 *   - go_scroll_50          (user scrolled past 50% of the page)
 *   - go_scroll_90          (user scrolled past 90% of the page)
 *   - go_time_15s           (user stayed 15 seconds)
 *   - go_time_30s           (user stayed 30 seconds)
 *   - go_time_60s           (user stayed 60 seconds)
 */
export default function GoTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // ── Click tracking via event delegation ──
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";

      if (href.startsWith("/go/checkout")) {
        const location = anchor.closest(".lp-sticky-bar")
          ? "sticky_bar"
          : anchor.closest("section")
            ? "section_2"
            : "section_1";
        trackEvent("go_click_5pack", { location, href });
      } else if (href.includes("amazon.com")) {
        trackEvent("go_click_amazon", { href });
      }
    }

    document.addEventListener("click", handleClick, true);

    // ── Scroll depth tracking ──
    let fired50 = false;
    let fired90 = false;

    function handleScroll() {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = scrollTop / docHeight;

      if (!fired50 && pct >= 0.5) {
        fired50 = true;
        trackEvent("go_scroll_50");
      }
      if (!fired90 && pct >= 0.9) {
        fired90 = true;
        trackEvent("go_scroll_90");
        // No need to keep listening
        window.removeEventListener("scroll", handleScroll);
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    // ── Time on page tracking ──
    const timers = [
      setTimeout(() => trackEvent("go_time_15s"), 15_000),
      setTimeout(() => trackEvent("go_time_30s"), 30_000),
      setTimeout(() => trackEvent("go_time_60s"), 60_000),
    ];

    // ── Page landing event (first-party beacon, always fires) ──
    trackEvent("go_page_view", {
      referrer: document.referrer || "(none)",
      ua: navigator.userAgent?.slice(0, 120) || "",
      screen: `${window.screen?.width}x${window.screen?.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("scroll", handleScroll);
      timers.forEach(clearTimeout);
    };
  }, []);

  return null;
}
