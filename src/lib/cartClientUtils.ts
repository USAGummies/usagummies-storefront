"use client";

// ---------------------------------------------------------------------------
// Shared client-side cart utilities.
// Extracted from multiple components to eliminate duplication.
// ---------------------------------------------------------------------------

export type CartLine = {
  quantity?: number;
  merchandise?: any;
};

export function storeCartId(cartId?: string | null): void {
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

export function getStoredCartId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

export function formatMoney(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount)) return "$0.00";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function parseBagsFromTitle(title?: string): number | undefined {
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

export function getBagsPerUnit(merchandise: any): number {
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

export function getTotalBags(cart: any): number {
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
