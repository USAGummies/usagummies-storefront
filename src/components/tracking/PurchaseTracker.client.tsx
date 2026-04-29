"use client";

import { useEffect, useRef } from "react";
import { trackPurchase } from "@/lib/analytics";
import { BASE_PRICE, perBagForQty } from "@/lib/bundles/pricing";

export default function PurchaseTracker() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // Check if we already tracked this session
    try {
      const key = "usa_purchase_tracked";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // continue anyway
    }

    // Extract order info from URL params if available
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order") || params.get("order_id") || `order_${Date.now()}`;
    const value = Number(params.get("total") || params.get("value")) || 25.0;

    // Reverse-engineer qty from order total against the canonical bundle pricing.
    // Try qty 1..12 and pick the one whose bundle total best matches `value`.
    // Fall back to ceil(value/BASE_PRICE) when no bundle qty matches.
    let qty = 1;
    let bestDelta = Infinity;
    for (let q = 1; q <= 12; q++) {
      const bundleTotal = perBagForQty(q) * q;
      const delta = Math.abs(bundleTotal - value);
      if (delta < bestDelta) {
        bestDelta = delta;
        qty = q;
      }
    }
    if (bestDelta > 1.0) {
      // Order doesn't match any 1-12 bundle (large bulk?) — fall back to value/BASE_PRICE
      qty = Math.max(1, Math.round(value / BASE_PRICE));
    }
    const perBagPrice = perBagForQty(qty);

    trackPurchase({
      id: orderId,
      value,
      currency: "USD",
      items: [{ id: "all-american-gummy-bears", name: "All American Gummy Bears", price: perBagPrice, quantity: qty }],
    });

    // Google Ads conversion (fires only if AW-* ID is configured via env)
    if (typeof window !== "undefined" && typeof window.gtag === "function" && window.__usaGadsConversionId) {
      window.gtag("event", "conversion", {
        send_to: window.__usaGadsConversionId,
        transaction_id: orderId,
        value,
        currency: "USD",
      });
    }
  }, []);

  return null;
}
