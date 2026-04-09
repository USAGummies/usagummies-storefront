"use client";

import { useEffect, useRef } from "react";
import { trackPurchase } from "@/lib/analytics";

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

    trackPurchase({
      id: orderId,
      value,
      currency: "USD",
      items: [{ id: "all-american-gummy-bears", name: "All American Gummy Bears", price: 5.99, quantity: Math.round(value / 5.99) || 1 }],
    });
  }, []);

  return null;
}
