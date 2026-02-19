"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoredCartId, storeCartId, getTotalBags } from "@/lib/cartClientUtils";

export function useCartBagCount() {
  const [bagCount, setBagCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const cartId = getStoredCartId();
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
    })
      .then((res) => res.json())
      .then((data) => {
        const cart = data?.cart ?? null;
        if (cart?.id) storeCartId(cart.id);
        setBagCount(getTotalBags(cart));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => refresh();
    window.addEventListener("cart:updated", handler);
    return () => window.removeEventListener("cart:updated", handler);
  }, [refresh]);

  return { bagCount, loading, refresh };
}
