"use client";

import { useCallback, useEffect, useState } from "react";

type CartLine = {
  quantity?: number;
  merchandise?: any;
};

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

function storeCartId(cartId?: string | null) {
  if (!cartId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cartId", cartId);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") {
    document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
  }
}

function parseBagsFromTitle(title?: string): number | undefined {
  const t = (title || "").toLowerCase();
  if (t.includes("single")) return 1;
  const m = t.match(/(\d+)\s*(?:bag|bags)\b/);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  const fallback = t.match(/(\d+)/);
  if (fallback?.[1]) {
    const n = Number(fallback[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function getBagsPerUnit(merchandise: any): number {
  const meta =
    merchandise?.bundleQty?.value ??
    merchandise?.bundleBags?.value ??
    merchandise?.metafield?.value;
  const metaNum = Number(meta);
  if (Number.isFinite(metaNum) && metaNum > 0) return metaNum;
  const parsed = parseBagsFromTitle(merchandise?.title);
  if (parsed && parsed > 0) return parsed;
  return 1;
}

function getTotalBags(cart: any) {
  const lines: CartLine[] =
    cart?.lines?.nodes ??
    cart?.lines?.edges?.map((e: any) => e?.node) ??
    [];
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => {
    const bagsPerUnit = getBagsPerUnit(line?.merchandise);
    const qty = Number(line?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
}

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
