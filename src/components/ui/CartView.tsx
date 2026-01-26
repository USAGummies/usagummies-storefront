// src/components/ui/CartView.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { CartLineControls } from "@/components/cart/CartLineControls.client";
import AddBagButton from "@/components/cart/AddBagButton.client";
import { cn } from "@/lib/cn";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY, MIN_PER_BAG } from "@/lib/bundles/pricing";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { trackEvent } from "@/lib/analytics";
import { getSafeCheckoutUrl, normalizeCheckoutUrl } from "@/lib/checkout";
import { ReviewHighlights } from "@/components/reviews/ReviewHighlights";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { GummyIconRow, HeroPackIcon } from "@/components/ui/GummyIcon";

type MoneyV2 = { amount: string; currencyCode: string };

const FEATURED_BUNDLE_QTYS = [5, 8, 12];
const SAVINGS_LADDER = [
  { qty: 4, label: "Savings start", caption: "4+ bags" },
  { qty: 5, label: "Free shipping", caption: "5+ bags" },
  { qty: 8, label: "Most popular", caption: "8 bags" },
  { qty: 12, label: "Best price", caption: "12 bags" },
];
const PROGRESS_MILESTONES = [
  { qty: 4, label: "Savings" },
  { qty: 5, label: "Free ship" },
  { qty: 8, label: "Popular" },
  { qty: 12, label: "Best price" },
];
const MISSION_TARGET_QTY = 8;
const MISSION_SOCIAL_PROOF = "87% of shoppers end at 8 bags.";
const COMPLETE_TARGETS = [5, 8, 12];
const TRUST_ITEMS = [
  {
    label: "Made in the USA",
    icon: "M5 3h14l-2 4 2 4H5v10H3V3h2z",
  },
  {
    label: "Money-back guarantee",
    icon: "M12 2 19 5v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z",
  },
  {
    label: "Secure checkout",
    icon: "M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z",
  },
  {
    label: "Easy returns",
    icon: "M12 5V2L7 7l5 5V9c3.3 0 6 2.7 6 6a6 6 0 0 1-6 6H6v-2h6a4 4 0 0 0 0-8z",
  },
];
const EXPRESS_CHECKOUT_METHODS = [
  {
    label: "Shop Pay",
    iconSrc: "/payments/shop-pay.svg",
  },
  {
    label: "Apple Pay",
    iconSrc: "/payments/apple-pay.svg",
  },
  {
    label: "Google Pay",
    iconSrc: "/payments/google-pay.svg",
  },
];

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

function formatMoney(amount: MoneyV2 | null | undefined) {
  const n = Number(amount?.amount ?? 0);
  const currency = String(amount?.currencyCode ?? "USD");
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatNumber(amount: number, currencyCode = "USD") {
  return formatMoney({ amount: amount.toFixed(2), currencyCode });
}

function clampPct(pct: number) {
  return Math.max(0, Math.min(100, pct));
}

function useCountUp(value: number, duration = 520) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(safeValue);
  const valueRef = useRef(safeValue);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const startValue = valueRef.current;
    if (target === startValue) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const diff = target - startValue;
    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - pct, 3);
      const nextValue = startValue + diff * eased;
      setDisplay(nextValue);
      if (pct < 1) {
        raf = window.requestAnimationFrame(tick);
      } else {
        valueRef.current = target;
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return display;
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

function bundleLabel(qty: number) {
  if (qty === 5) return "Free shipping";
  if (qty === 8) return "Most popular";
  if (qty === 12) return "Bulk savings";
  return "";
}

function dealToastMessage(milestone: { qty: number; label: string }) {
  if (milestone.qty === 4) return "Deal improved: savings pricing unlocked.";
  if (milestone.qty === 5) return "Deal improved: free shipping unlocked.";
  if (milestone.qty === 8) return "Deal improved: most popular price unlocked.";
  if (milestone.qty === 12) return "Deal improved: best price per bag unlocked.";
  return `Deal improved: ${milestone.label.toLowerCase()}.`;
}

export function CartView({ cart, onClose }: { cart: any; onClose?: () => void }) {
  const [localCart, setLocalCart] = useState(cart);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [bundlePending, setBundlePending] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [stampBurstQty, setStampBurstQty] = useState<number | null>(null);
  const [dealToast, setDealToast] = useState<string | null>(null);
  const dealToastTimerRef = useRef<number | null>(null);
  const cartItemsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setLocalCart(cart);
  }, [cart]);
  const refreshCart = useMemo(
    () => () => {
      const cartId =
        typeof window !== "undefined" ? window.localStorage.getItem("cartId") : null;
      fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
      })
        .then((r) => r.json())
        .then((data) => {
          const nextCart = data.cart ?? null;
          if (nextCart?.id) storeCartId(nextCart.id);
          setLocalCart(nextCart);
        })
        .catch(() => {});
    },
    []
  );
  const isDrawer = Boolean(onClose);

  const lines =
    (localCart?.lines as any)?.nodes ??
    (localCart?.lines as any)?.edges?.map((e: any) => e?.node) ??
    [];

  const totalBags = lines.reduce((sum: number, l: any) => {
    const bagsPerUnit = getBagsPerUnit(l?.merchandise);
    const qty = Number(l?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
  const prevBagsRef = useRef(totalBags);
  const topMilestone = SAVINGS_LADDER[SAVINGS_LADDER.length - 1];
  const bestPriceReached = totalBags >= topMilestone.qty;
  const nextMilestone = bestPriceReached
    ? topMilestone
    : SAVINGS_LADDER.find((milestone) => totalBags < milestone.qty) || topMilestone;
  const bundlePricing = totalBags > 0 ? pricingForQty(totalBags) : null;
  const summaryCurrency = localCart?.cost?.subtotalAmount?.currencyCode || "USD";
  const baseTotal = totalBags > 0 ? BASE_PRICE * totalBags : 0;
  const bundleSavings =
    bundlePricing && baseTotal > bundlePricing.total
      ? baseTotal - bundlePricing.total
      : 0;
  const subtotalNumber = bundlePricing
    ? bundlePricing.total
    : Number(localCart?.cost?.subtotalAmount?.amount ?? 0);
  const animatedSubtotal = useCountUp(subtotalNumber);
  const animatedSavings = useCountUp(bundleSavings);
  const animatedPerBag = useCountUp(bundlePricing?.perBag ?? 0);
  const bundlePerBagText =
    bundlePricing ? formatNumber(animatedPerBag, summaryCurrency) : "";
  const bundleSavingsText =
    bundleSavings > 0 ? formatNumber(animatedSavings, summaryCurrency) : "";
  const subtotal = Number.isFinite(subtotalNumber)
    ? formatNumber(animatedSubtotal, summaryCurrency)
    : "";
  const cartPeekLines = lines.slice(0, 3);
  const cartPeekExtra = Math.max(0, lines.length - cartPeekLines.length);
  const cartPeekSubtotal = subtotal || formatNumber(subtotalNumber, summaryCurrency);
  const currentTotal = bundlePricing?.total ?? baseTotal;
  const nextTierAddQty = totalBags < nextMilestone.qty ? nextMilestone.qty - totalBags : null;
  const nextTierPricing = nextTierAddQty ? pricingForQty(totalBags + nextTierAddQty) : null;
  const nextTierAddTotal =
    nextTierAddQty && nextTierPricing ? Math.max(0, nextTierPricing.total - currentTotal) : null;
  const nextTierAddTotalText =
    nextTierAddTotal !== null ? formatNumber(nextTierAddTotal, summaryCurrency) : "";
  const nextTierCtaLabel = nextTierAddQty
    ? `Lock in savings now: +${nextTierAddQty} bag${nextTierAddQty === 1 ? "" : "s"} (total ${nextMilestone.qty})${
        nextTierAddTotalText ? ` - +${nextTierAddTotalText}` : ""
      }`
    : "";
  const bestPriceApplied = bestPriceReached;
  const missionRemaining = Math.max(0, MISSION_TARGET_QTY - totalBags);
  const missionProgressCount = Math.min(totalBags, topMilestone.qty);
  const missionProgressPct = clampPct(
    Math.round((missionProgressCount / topMilestone.qty) * 100)
  );
  const dealProgressPct = clampPct(
    Math.round((Math.min(totalBags, topMilestone.qty) / topMilestone.qty) * 100)
  );
  const missionCtaLabel =
    missionRemaining > 0
      ? `Lock in savings now: add ${missionRemaining} bag${missionRemaining === 1 ? "" : "s"} (total ${MISSION_TARGET_QTY})`
      : `Savings locked at ${MISSION_TARGET_QTY} bags`;
  const mysteryBonusLine = bestPriceReached
    ? "Mystery extra revealed: Patriot Pride sticker (while supplies last)."
    : "Mystery extra unlocks at 12 bags.";
  const completeTargets = COMPLETE_TARGETS.filter((target) => target > totalBags).map((target) => {
    const addQty = target - totalBags;
    const targetPricing = pricingForQty(target);
    const addTotal = Math.max(0, targetPricing.total - currentTotal);
    return {
      target,
      addQty,
      addTotalText: formatNumber(addTotal, summaryCurrency),
    };
  });

  const unlocked = totalBags >= FREE_SHIP_QTY;
  const freeShipGap = Math.max(0, FREE_SHIP_QTY - totalBags);
  const freeShipLine = unlocked
    ? "Free shipping unlocked."
    : `Add ${freeShipGap} more bag${freeShipGap === 1 ? "" : "s"} for free shipping.`;
  const shippingSummary = unlocked ? "Free" : "Calculated at checkout";
  const shippingHint = unlocked ? "Free shipping unlocked" : `Free at ${FREE_SHIP_QTY}+ bags`;
  const estimatedTotal = subtotal;

  const savingsGap = Math.max(0, 4 - totalBags);
  let cartHeadline = "";
  if (totalBags === 0) {
    cartHeadline = "Add bags to unlock savings.";
  } else if (totalBags < 4) {
    cartHeadline = `You're ${savingsGap} bag${savingsGap === 1 ? "" : "s"} away from savings pricing.`;
  } else if (totalBags === 4) {
    cartHeadline = "Savings pricing unlocked.";
  } else if (totalBags >= 5 && totalBags < 8) {
    cartHeadline = "Free shipping unlocked.";
  } else if (totalBags === 8) {
    cartHeadline = "Great choice - most popular size.";
  } else if (totalBags > 8 && totalBags < 12) {
    cartHeadline = "Bulk savings locked in.";
  } else {
    cartHeadline = "Best price per bag unlocked.";
  }
  const cartSubline = "Free shipping at 5+ bags.";

  const dealStatusLabel = bestPriceReached
    ? "Best price applied"
    : totalBags >= 4
      ? "Savings applied"
      : "Standard pricing";
  const dealStatusHint = bestPriceReached
    ? "You are at the lowest per-bag rate."
    : totalBags >= 4
      ? "Pricing auto-optimizes as you add bags."
      : "Add bags to unlock savings and free shipping.";
  const dealSavingsLine =
    bundleSavings > 0
      ? `You saved ${bundleSavingsText} vs single bags.`
      : totalBags > 0
        ? "Add bags to drop your per-bag price."
        : "";

  const savingsAddQty =
    totalBags > 0 && totalBags < 4 ? 4 - totalBags : totalBags === 4 ? 1 : null;
  const savingsButtonLabel = savingsAddQty
    ? totalBags < 4
      ? `Lock in savings now: +${savingsAddQty} bag${savingsAddQty === 1 ? "" : "s"} (total 4)`
      : "Lock in savings now: +1 bag (total 5)"
    : "";
  const upgradeToEightAdd = totalBags > 0 && totalBags < 8 ? 8 - totalBags : null;
  const upgradeToEightPrice =
    upgradeToEightAdd && Number.isFinite(pricingForQty(8).total - currentTotal)
      ? Math.max(0, pricingForQty(8).total - currentTotal)
      : null;
  const upgradeToEightLabel = upgradeToEightAdd
    ? `Lock in savings now: +${upgradeToEightAdd} (total 8) - ${formatNumber(
        upgradeToEightPrice ?? pricingForQty(8).total,
        summaryCurrency
      )}`
    : "";
  const showActionButtons = Boolean(savingsAddQty || upgradeToEightAdd);

  useEffect(() => {
    if (unlocked) {
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 900);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  useEffect(() => {
    const prev = prevBagsRef.current;
    let timeout: number | null = null;
    if (totalBags > prev) {
      const unlockedMilestones = SAVINGS_LADDER.filter(
        (milestone) => prev < milestone.qty && totalBags >= milestone.qty
      );
      const latest = unlockedMilestones[unlockedMilestones.length - 1];
      if (latest) {
        setStampBurstQty(latest.qty);
        timeout = window.setTimeout(() => setStampBurstQty(null), 700);
        setDealToast(dealToastMessage(latest));
        if (dealToastTimerRef.current) {
          window.clearTimeout(dealToastTimerRef.current);
        }
        dealToastTimerRef.current = window.setTimeout(() => {
          setDealToast(null);
        }, 2400);
      }
    }
    prevBagsRef.current = totalBags;
    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [totalBags]);

  useEffect(() => {
    return () => {
      if (dealToastTimerRef.current) {
        window.clearTimeout(dealToastTimerRef.current);
      }
    };
  }, []);

  async function addBags(qty: number) {
    const addQty = Math.max(1, Math.round(qty));
    const maxAddable = Math.max(0, 99 - totalBags);
    if (bundlePending || addQty <= 0 || maxAddable <= 0) return;
    const finalQty = Math.min(addQty, maxAddable);
    trackEvent("cart_bundle_set", {
      addQty: finalQty,
      currentQty: totalBags,
      nextQty: totalBags + finalQty,
      context: cartContext,
    });
    setBundlePending(true);
    setBundleError(null);
    try {
      const cartId =
        typeof window !== "undefined" ? window.localStorage.getItem("cartId") : null;
      if (cartId && typeof document !== "undefined") {
        document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
      }
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId: SINGLE_BAG_VARIANT_ID,
          quantity: finalQty,
          cartId: cartId || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not add bags.");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);
      setLocalCart(json.cart ?? null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
    } catch (err: any) {
      setBundleError(err?.message || "Could not add bags.");
    } finally {
      setBundlePending(false);
    }
  }

  const hasLines = lines.length > 0;
  const showNextTierCta = Boolean(hasLines && nextTierAddQty && nextTierAddQty > 0);
  const cartContext = onClose ? "drawer" : "cart";
  const secondaryCta = onClose
    ? { href: "/cart", label: "View cart" }
    : { href: "/shop#bundle-pricing", label: "Shop now" };
  const showStickyCheckout = !onClose && hasLines && Boolean(localCart?.checkoutUrl);
  const checkoutHref = useMemo(
    () => normalizeCheckoutUrl(localCart?.checkoutUrl) ?? localCart?.checkoutUrl,
    [localCart?.checkoutUrl]
  );
  const drawerSavingsLine =
    bundleSavings > 0
      ? `You saved ${bundleSavingsText} vs single bags.`
      : totalBags > 0
        ? "Savings pending."
        : "";
  const nextTierDescriptor =
    nextMilestone.qty === 4
      ? "savings pricing"
      : nextMilestone.qty === 5
        ? "free shipping"
        : nextMilestone.qty === 8
          ? "most popular price"
          : "best price";
  const drawerUpsellLabel = nextTierAddQty
    ? `Add ${nextTierAddQty} bag${nextTierAddQty === 1 ? "" : "s"} for ${nextTierDescriptor}.`
    : "";

  function handleCheckoutClick(event?: MouseEvent<HTMLAnchorElement>) {
    const safeCheckoutUrl = getSafeCheckoutUrl(
      localCart?.checkoutUrl,
      `cart_${cartContext}`,
      typeof window !== "undefined" ? window.location.host : undefined
    );
    if (!safeCheckoutUrl) {
      event?.preventDefault();
      return;
    }
    if (event?.currentTarget?.href && event.currentTarget.href !== safeCheckoutUrl) {
      event.preventDefault();
      window.location.href = safeCheckoutUrl;
    }
    const fallbackSubtotal = Number(localCart?.cost?.subtotalAmount?.amount || 0);
    trackEvent("checkout_click", {
      context: cartContext,
      totalBags,
      subtotal: bundlePricing?.total ?? fallbackSubtotal,
    });
    onClose?.();
  }

  function handleEditItemsClick() {
    cartItemsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (isDrawer && localCart === null) {
    return (
      <div className="px-4 py-6">
        <div className="skeleton h-4 w-32" />
        <div className="mt-4 grid gap-3">
          <div className="skeleton skeleton-block h-20 w-full" />
          <div className="skeleton skeleton-block h-32 w-full" />
          <div className="skeleton skeleton-block h-24 w-full" />
        </div>
        <div className="mt-4 grid gap-2">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-4 w-40" />
        </div>
      </div>
    );
  }

  if (isDrawer) {
    return (
      <div className="px-4 py-4 text-[var(--text)]">
        {hasLines ? (
          <>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3 shadow-[0_10px_24px_rgba(15,27,45,0.08)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Order summary
                </div>
                <div className="text-[11px] font-semibold text-[var(--muted)]">
                  {totalBags} bag{totalBags === 1 ? "" : "s"}
                </div>
              </div>
              <div className="mt-2 divide-y divide-[rgba(15,27,45,0.08)]">
                {lines.map((l: any) => {
                  const title = l?.merchandise?.product?.title || "Item";
                  const img =
                    l?.merchandise?.image?.url ||
                    l?.merchandise?.product?.featuredImage?.url ||
                    null;
                  const lineQty = Number(l?.quantity) || 0;
                  const bagsPerUnit = getBagsPerUnit(l?.merchandise);
                  const lineBags = bagsPerUnit * lineQty;
                  return (
                    <div key={l.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3">
                        <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]">
                          {img ? (
                            <Image
                              src={img}
                              alt={title}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-[var(--text)]">
                            {title}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">
                            Bag count: {lineBags} bag{lineBags === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2">
                        <CartLineControls
                          lineId={l.id}
                          quantity={lineQty}
                          onChange={refreshCart}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-2 text-[11px] text-[var(--muted)]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1">
                    <span>Bag count</span>
                    <span className="font-semibold text-[var(--text)]">
                      {totalBags} bag{totalBags === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1">
                    <span>Shipping</span>
                    <span className="font-semibold text-[var(--text)]">{shippingSummary}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[12px] font-semibold text-[var(--text)]">
                  <span>Total</span>
                  <span className="text-base font-black">{estimatedTotal}</span>
                </div>
                {drawerSavingsLine ? (
                  <div className="text-[10px] font-semibold text-[var(--candy-red)]">
                    {drawerSavingsLine}
                  </div>
                ) : null}
              </div>
            </div>

            {localCart?.checkoutUrl ? (
              <div className="mt-3 grid gap-2">
                <div className="grid grid-cols-3 gap-2">
                  {EXPRESS_CHECKOUT_METHODS.map((method) => (
                    <a
                      key={method.label}
                      href={checkoutHref ?? localCart.checkoutUrl}
                      onClick={handleCheckoutClick}
                      aria-label={`${method.label} checkout`}
                      className="flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--text)] transition"
                    >
                      <span className="flex h-8 w-full items-center justify-center">
                        <Image
                          src={method.iconSrc}
                          alt=""
                          aria-hidden="true"
                          width={72}
                          height={20}
                          sizes="72px"
                          className="h-4 w-auto opacity-75"
                        />
                      </span>
                      <span className="text-[9px] text-[var(--muted)]">{method.label}</span>
                    </a>
                  ))}
                </div>

                <a
                  href={checkoutHref ?? localCart.checkoutUrl}
                  className="btn btn-candy w-full justify-center pressable"
                  onClick={handleCheckoutClick}
                >
                  <span className="inline-flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
                      />
                    </svg>
                    Secure checkout
                  </span>
                </a>
              </div>
            ) : null}

            <div className="mt-3 relative border-t border-[rgba(15,27,45,0.08)] pt-3 text-[11px] text-[var(--muted)]">
              <Image
                src="/website%20assets/Train-02.png"
                alt=""
                aria-hidden="true"
                width={640}
                height={420}
                sizes="120px"
                className="pointer-events-none absolute -right-8 -top-8 w-28 opacity-10"
              />
              <div className="relative grid gap-1 text-[11px] font-semibold text-[var(--muted)]">
                <div className="flex items-center gap-2 opacity-70" aria-hidden="true">
                  <GummyIconRow size={12} />
                </div>
                {[
                  "Ships within 24 hours",
                  "Easy returns",
                  "Secure checkout",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(15,27,45,0.08)] text-[10px] text-[var(--text)]">
                      ✓
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {showNextTierCta ? (
              <details className="mt-3 border-t border-[rgba(15,27,45,0.08)] pt-3 text-[11px] text-[var(--muted)]">
                <summary className="cursor-pointer font-semibold text-[var(--text)]">
                  A better value is available
                </summary>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => (nextTierAddQty ? addBags(nextTierAddQty) : null)}
                    disabled={bundlePending}
                    className="inline-flex items-center rounded-full border border-[rgba(15,27,45,0.12)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text)] transition hover:border-[rgba(239,59,59,0.35)]"
                  >
                    {bundlePending ? "Locking in..." : drawerUpsellLabel}
                  </button>
                </div>
              </details>
            ) : null}

            {bundleError ? (
              <div className="mt-2 text-xs text-[var(--red)]">{bundleError}</div>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 text-sm text-[var(--muted)]">
            Your cart is empty.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("px-4 py-4 text-[var(--text)]", showStickyCheckout && "pb-12")}>
      {hasLines ? (
        <>
          <div
            className={cn(
              "sticky z-30 -mx-4 px-4",
              isDrawer ? "top-0 pt-2" : "top-16 pt-3 sm:top-20"
            )}
          >
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white/92 p-3 shadow-[0_12px_30px_rgba(15,27,45,0.08)] backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  <HeroPackIcon size={16} className="opacity-90" />
                  <GummyIconRow
                    size={12}
                    variants={["red", "yellow", "green"]}
                    className="opacity-80"
                  />
                  <span>In your cart</span>
                </div>
                <div className="text-[11px] font-semibold text-[var(--text)]">
                  {totalBags} bag{totalBags === 1 ? "" : "s"} • {cartPeekSubtotal}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                {cartPeekLines.map((l: any) => {
                  const title = l?.merchandise?.product?.title || "Item";
                  const img =
                    l?.merchandise?.image?.url ||
                    l?.merchandise?.product?.featuredImage?.url ||
                    null;
                  const lineQty = Number(l?.quantity) || 0;
                  const bagsPerUnit = getBagsPerUnit(l?.merchandise);
                  const lineBags = bagsPerUnit * lineQty;
                  return (
                    <div
                      key={l.id}
                      className="flex min-w-[140px] items-center gap-2 rounded-full border border-[rgba(15,27,45,0.12)] bg-white px-2 py-1"
                    >
                      <div className="relative h-7 w-7 overflow-hidden rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]">
                        {img ? (
                          <Image
                            src={img}
                            alt={title}
                            fill
                            sizes="28px"
                            className="object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-[var(--text)]">
                          {title}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {lineBags} bag{lineBags === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {cartPeekExtra > 0 ? (
                  <div className="rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[10px] font-semibold text-[var(--muted)]">
                    +{cartPeekExtra} more
                  </div>
                ) : null}
              </div>
              {isDrawer ? (
                <div className="mt-3 border-t border-[rgba(15,27,45,0.12)] pt-3">
                  <div className="grid gap-2 text-[11px] text-[var(--muted)]">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center justify-between rounded-full border border-[rgba(15,27,45,0.12)] bg-white px-2 py-1">
                        <span>Items</span>
                        <span className="font-black text-[var(--text)]">{subtotal}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-full border border-[rgba(15,27,45,0.12)] bg-white px-2 py-1">
                        <span>Shipping</span>
                        <span className="font-semibold text-[var(--text)]">{shippingSummary}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[12px] font-semibold text-[var(--text)]">
                      <span>Estimated total</span>
                      <span className="text-base font-black">{estimatedTotal}</span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">{shippingHint}</div>
                    {bundleSavings > 0 ? (
                      <div className="text-[10px] font-semibold text-[var(--candy-red)]">
                        You saved {bundleSavingsText} today vs single bags.
                      </div>
                    ) : null}
                  </div>

                  {localCart?.checkoutUrl ? (
                    <>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {EXPRESS_CHECKOUT_METHODS.map((method) => (
                          <a
                            key={method.label}
                            href={checkoutHref ?? localCart.checkoutUrl}
                            onClick={handleCheckoutClick}
                            aria-label={`${method.label} checkout`}
                            className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white/80 px-2 py-2 text-[9px] font-semibold text-[var(--muted)]"
                          >
                            <span className="flex h-9 w-full items-center justify-center rounded-full border border-[rgba(15,27,45,0.08)] bg-white">
                              <Image
                                src={method.iconSrc}
                                alt=""
                                aria-hidden="true"
                                width={72}
                                height={20}
                                sizes="72px"
                                className="h-4 w-auto opacity-80"
                              />
                            </span>
                            <span className="text-[9px] text-[var(--muted)]">{method.label}</span>
                          </a>
                        ))}
                      </div>

                      <a
                        href={checkoutHref ?? localCart.checkoutUrl}
                        className="btn btn-candy mt-3 w-full justify-center pressable"
                        onClick={handleCheckoutClick}
                      >
                        <span className="inline-flex items-center gap-2">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
                            />
                          </svg>
                          Secure checkout
                        </span>
                      </a>
                    </>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-[var(--muted)]">
                    <button
                      type="button"
                      onClick={handleEditItemsClick}
                      className="underline underline-offset-4 hover:text-[var(--text)]"
                    >
                      Edit items
                    </button>
                    <Link
                      href={secondaryCta.href}
                      className="underline underline-offset-4 hover:text-[var(--text)]"
                      onClick={onClose}
                    >
                      {secondaryCta.label}
                    </Link>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Ships in 24 hours • Easy returns
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              "grid gap-5",
              !onClose && "lg:grid-cols-[1.15fr_0.85fr] lg:items-start"
            )}
          >
          <div className="flex flex-col gap-4">
            <div className="metal-panel patriot-sheen relative rounded-3xl border border-[rgba(199,160,98,0.35)] p-4">
              <span className="usa-stamp usa-stamp--corner">Made in USA</span>
              {dealToast ? (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(239,59,59,0.35)] bg-[rgba(239,59,59,0.12)] px-3 py-1 text-[11px] font-semibold text-[var(--candy-red)] shadow-[0_12px_30px_rgba(239,59,59,0.18)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--candy-red)] animate-pbxPulse" />
                  {dealToast}
                </div>
              ) : null}
              <div
                className={cn(
                  "rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white/85 p-3 shadow-[0_14px_30px_rgba(15,27,45,0.08)]",
                  Boolean(stampBurstQty) && "ring-2 ring-[rgba(239,59,59,0.25)]"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Best deal status
                    </div>
                    <div className="text-base font-black text-[var(--text)]">{dealStatusLabel}</div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">{dealStatusHint}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Per bag
                    </div>
                    <div className="text-lg font-black text-[var(--text)]">
                      {bundlePerBagText ? `${bundlePerBagText} / bag` : "—"}
                    </div>
                    {dealSavingsLine ? (
                      <div className="text-[11px] font-semibold text-[var(--candy-red)]">
                        {dealSavingsLine}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[var(--muted)]">
                  Pricing auto-optimizes for your best per-bag deal. Adding bags always increases your total.
                </div>
              </div>

              <div className="mt-3 text-sm font-black text-[var(--text)]">{cartHeadline}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{cartSubline}</div>
              <div className="mt-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  <span>Deal progress</span>
                  <span>
                    {totalBags}/{topMilestone.qty} bags
                  </span>
                </div>
                <div
                  className={cn(
                    "relative mt-2 h-2 w-full overflow-hidden rounded-full border border-[rgba(15,27,45,0.12)] bg-white",
                    justUnlocked && "ring-2 ring-[var(--red)]"
                  )}
                >
                  <div
                    className={cn(
                      "h-full bg-gradient-to-r from-[var(--red)] via-[var(--gold)] to-[var(--red)] transition-all",
                      justUnlocked && "animate-pbxPulse"
                    )}
                    style={{ width: `${dealProgressPct}%` }}
                  />
                  {PROGRESS_MILESTONES.map((milestone) => {
                    const left = (milestone.qty / topMilestone.qty) * 100;
                    const reached = totalBags >= milestone.qty;
                    const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                    const burst = stampBurstQty === milestone.qty;
                    return (
                      <span
                        key={milestone.qty}
                        className={cn(
                          "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border",
                          "border-[rgba(15,27,45,0.25)] bg-white",
                          reached && "border-[rgba(239,59,59,0.65)] bg-[rgba(239,59,59,0.25)]",
                          isNext && "ring-2 ring-[rgba(239,59,59,0.35)]",
                          burst && "animate-pbxPulse"
                        )}
                        style={{ left: `calc(${left}% - 5px)` }}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] font-semibold text-[var(--muted)]">
                  {PROGRESS_MILESTONES.map((milestone) => {
                    const reached = totalBags >= milestone.qty;
                    const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                    return (
                      <div
                        key={milestone.qty}
                        className={cn(
                          "text-center",
                          reached && "text-[var(--text)]",
                          isNext && "text-[var(--candy-red)]"
                        )}
                      >
                        {milestone.label}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-[11px] text-[var(--muted)]">{freeShipLine}</div>
              </div>
              {showActionButtons ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    {savingsAddQty ? (
                      <AddBagButton
                        label={savingsButtonLabel}
                        pendingLabel="Locking in..."
                        disabled={bundlePending}
                        onAdd={() => addBags(savingsAddQty)}
                      />
                    ) : null}
                    {upgradeToEightAdd ? (
                      <AddBagButton
                        label={upgradeToEightLabel}
                        pendingLabel="Locking in..."
                        disabled={bundlePending}
                        onAdd={() => addBags(upgradeToEightAdd)}
                      />
                    ) : null}
                  </div>
                  {isDrawer ? (
                    <div className="relative h-28 w-24 shrink-0 self-center mr-8">
                      <Image
                        src="/website%20assets/StatueofLiberty.png"
                        alt=""
                        fill
                        sizes="96px"
                        className="object-contain"
                        aria-hidden="true"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <details className="mt-3 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer font-semibold text-[var(--text)]">
                  See savings rules
                </summary>
                <ul className="mt-2 space-y-1">
                  <li>Discounts start at 4 bags</li>
                  <li>Free shipping at 5+ bags</li>
                  <li>Most customers choose 8 bags</li>
                  <li>Per-bag price caps at {formatNumber(MIN_PER_BAG, summaryCurrency)} after 12+ bags</li>
                </ul>
              </details>
            </div>

            <div className="candy-panel rounded-[32px] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    <span>Lock in your savings</span>
                    <GummyIconRow size={12} className="opacity-80" />
                  </div>
                  <div className="text-lg font-black text-[var(--text)]">Save more with more bags</div>
                  <div className="text-xs text-[var(--muted)]">
                    Savings apply to your total bag count. Selecting a size adds that many bags to your cart.
                  </div>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  In your cart:{" "}
                  <span className="font-semibold text-[var(--text)]">
                    {totalBags} bag{totalBags === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {SAVINGS_LADDER.map((milestone) => {
                  const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                  const isBest = bestPriceReached && milestone.qty === topMilestone.qty;
                  const isReached = totalBags >= milestone.qty;
                  const isPopularComplete =
                    milestone.qty === MISSION_TARGET_QTY && totalBags >= milestone.qty;
                  return (
                    <div
                      key={milestone.qty}
                      className={cn(
                        "rounded-2xl border px-2.5 py-2 text-[11px] font-semibold",
                        "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)]",
                        (isNext || isBest) && "border-[rgba(239,59,59,0.45)] bg-[rgba(239,59,59,0.08)]",
                        isReached && !(isNext || isBest) && "opacity-90"
                      )}
                    >
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        {milestone.label}
                      </div>
                      <div>{milestone.caption}</div>
                      {isNext ? (
                        <div className="text-[10px] font-semibold text-[var(--candy-red)]">Next up</div>
                      ) : isBest ? (
                        <div className="text-[10px] font-semibold text-[var(--candy-red)]">
                          Best price applied
                        </div>
                      ) : isPopularComplete ? (
                        <div className="text-[10px] font-semibold text-[var(--candy-red)]">
                          Most popular mission complete
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] font-semibold text-[var(--muted)]">
                {MISSION_SOCIAL_PROOF}
              </div>
              <div className="mt-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Mission to savings
                  </div>
                  <div className="text-[11px] font-semibold text-[var(--text)]">
                    Progress: {missionProgressCount}/{topMilestone.qty} bags
                  </div>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-[var(--muted)]">
                  Hit 8 bags to unlock the crowd-favorite price.
                </div>
                <div className="mt-2 mission-bar" aria-hidden="true">
                  <div className="mission-bar__fill" style={{ width: `${missionProgressPct}%` }} />
                  {SAVINGS_LADDER.map((milestone) => {
                    const left = (milestone.qty / topMilestone.qty) * 100;
                    const reached = totalBags >= milestone.qty;
                    const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                    return (
                      <span
                        key={milestone.qty}
                        className={cn(
                          "mission-bar__tick",
                          reached && "mission-bar__tick--reached",
                          isNext && "mission-bar__tick--next"
                        )}
                        style={{ left: `${left}%` }}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {SAVINGS_LADDER.map((milestone) => {
                    const reached = totalBags >= milestone.qty;
                    const burst = stampBurstQty === milestone.qty;
                    return (
                      <div key={milestone.qty} className="mission-stamp">
                        <div
                          className={cn(
                            "mission-stamp__badge",
                            reached ? "mission-stamp__badge--earned" : "mission-stamp__badge--locked",
                            burst && "mission-stamp__badge--burst"
                          )}
                          aria-label={`${milestone.label} stamp`}
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M12 3.6 14.2 8l4.9.7-3.5 3.4.8 4.9L12 15.1 7.6 17l.8-4.9L4.9 8.7 9.8 8 12 3.6z"
                            />
                          </svg>
                        </div>
                        <div className="text-[10px] font-semibold text-[var(--muted)]">
                          {milestone.qty}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {missionRemaining > 0 ? (
                    <button
                      type="button"
                      onClick={() => addBags(missionRemaining)}
                      disabled={bundlePending}
                      className="btn btn-candy pressable w-full sm:w-auto"
                    >
                    {bundlePending ? "Locking in..." : missionCtaLabel}
                    </button>
                  ) : (
                    <span className="inline-flex rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]">
                      {missionCtaLabel}
                    </span>
                  )}
                </div>
                {completeTargets.length ? (
                  <div className="mt-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Complete your savings
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {completeTargets.map((target) => (
                        <button
                          key={target.target}
                          type="button"
                          onClick={() => addBags(target.addQty)}
                          disabled={bundlePending}
                          className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-left text-[11px] font-semibold text-[var(--text)] transition hover:border-[rgba(239,59,59,0.35)]"
                        >
                          <div>
                            Lock in savings now: +{target.addQty} bag{target.addQty === 1 ? "" : "s"}{" "}
                            (total {target.target})
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--muted)]">
                            +{target.addTotalText}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Finish your bag count
                  </div>
                  <div className="mt-2 grid gap-1">
                    {[
                      { qty: 4, label: "Savings pricing unlocked" },
                      { qty: 5, label: "Free shipping unlocked" },
                      { qty: 8, label: "Crowd-favorite price unlocked" },
                      {
                        qty: 12,
                        label: bestPriceReached
                          ? "Patriot Pride sticker revealed"
                          : "Mystery extra unlocks",
                      },
                    ].map((item) => {
                      const done = totalBags >= item.qty;
                      return (
                        <div
                          key={item.qty}
                          className={cn(
                            "flex items-center gap-2 text-[11px] font-semibold",
                            done ? "text-[var(--text)]" : "text-[var(--muted)]"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex h-4 w-4 items-center justify-center rounded-full border",
                              done
                                ? "border-[rgba(239,59,59,0.5)] bg-[rgba(239,59,59,0.16)] text-[var(--candy-red)]"
                                : "border-[rgba(15,27,45,0.2)] bg-white text-[var(--muted)]"
                            )}
                            aria-hidden="true"
                          >
                            {done ? (
                              <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
                                <path
                                  fill="currentColor"
                                  d="M9.2 16.2 5.5 12.5l1.4-1.4 2.3 2.3 7.2-7.2 1.4 1.4z"
                                />
                              </svg>
                            ) : null}
                          </span>
                          <span>
                            {item.label}
                            {item.qty === 12 ? " (12 bags)" : ` (${item.qty}+ bags)`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[var(--muted)]">{mysteryBonusLine}</div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {FEATURED_BUNDLE_QTYS.map((qty) => {
                  const nextBags = totalBags + qty;
                  const pricing = pricingForQty(nextBags);
                  const addTotal = Math.max(0, pricing.total - currentTotal);
                  const totalText = formatNumber(addTotal, summaryCurrency);
                  const nextTotalText = formatNumber(pricing.total, summaryCurrency);
                  const perBagText = formatNumber(pricing.perBag, summaryCurrency);
                  const savings = Math.max(0, BASE_PRICE * nextBags - pricing.total);
                  const savingsText = savings > 0 ? formatNumber(savings, summaryCurrency) : "";
                  const label = bundleLabel(nextBags);
                  const isActive = false;
                  const isBest = nextBags === 8;
                  const freeShip = nextBags >= FREE_SHIP_QTY;

                  return (
                    <button
                      key={qty}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => addBags(qty)}
                      disabled={bundlePending}
                      className={cn(
                        "relative rounded-2xl border px-3 py-3 text-left transition overflow-hidden",
                        "bg-white text-[var(--text)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(239,59,59,0.35)]",
                        "transition-transform",
                        isActive
                          ? "border-[var(--candy-red)] bg-[rgba(239,59,59,0.08)] shadow-[0_14px_32px_rgba(239,59,59,0.16)] ring-2 ring-[rgba(239,59,59,0.2)]"
                          : "border-[rgba(15,27,45,0.12)] hover:border-[rgba(239,59,59,0.3)] hover:shadow-[0_12px_28px_rgba(15,27,45,0.12)]",
                        isBest &&
                          "scale-[1.04] sm:scale-[1.06] z-10 border-[rgba(239,59,59,0.35)] bg-[rgba(239,59,59,0.04)]",
                        bundlePending && !isActive && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      {isBest ? (
                        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff4b4b] via-[#f8d44f] to-[#ff4b4b] opacity-90" />
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-black text-[var(--text)]">+{qty} bags</div>
                        {label ? (
                          <span className="rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]">
                            {label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[11px] text-[var(--muted)]">
                        New total: {nextBags} bags
                      </div>
                      <div className="mt-2 text-xl font-black text-[var(--text)]">+{totalText}</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        Total after add: {nextTotalText} - ~{perBagText} / bag
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[var(--candy-red)]">
                          {savingsText ? `Save ${savingsText} total` : "Standard price"}
                        </span>
                        {freeShip ? (
                          <span className="text-[var(--muted)]">Free shipping</span>
                        ) : null}
                      </div>
                      {isBest ? (
                        <div className="mt-2 text-[11px] font-semibold text-[var(--muted)]">
                          87% of shoppers end at 8 bags total.
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {bundleError ? (
                <div className="mt-3 text-xs text-[var(--red)]">{bundleError}</div>
              ) : null}
              {bundlePending ? (
                <div className="mt-2 text-xs text-[var(--muted)]">Locking in savings...</div>
              ) : null}
            </div>

            {isDrawer ? (
              <div ref={cartItemsRef} className="flex flex-col gap-3">
                {lines.length === 0 ? (
                  <div className="metal-panel rounded-2xl border border-[rgba(15,27,45,0.12)] p-4 text-sm text-[var(--muted)]">
                    Your cart is empty.
                  </div>
                ) : (
                  lines.map((l: any) => {
                    const title = l?.merchandise?.product?.title || "Item";
                    const variant = l?.merchandise?.title || "";
                    const img =
                      l?.merchandise?.image?.url ||
                      l?.merchandise?.product?.featuredImage?.url ||
                      null;
                    const lineQty = Number(l?.quantity) || 0;
                    const bagsPerUnit = getBagsPerUnit(l?.merchandise);
                    const lineBags = bagsPerUnit * lineQty;
                    const lineCurrency = l?.cost?.totalAmount?.currencyCode || "USD";
                    const linePricing = lineBags > 0 ? pricingForQty(lineBags) : null;
                    const lineTotal = linePricing
                      ? formatMoney({ amount: linePricing.total.toFixed(2), currencyCode: lineCurrency })
                      : l.cost?.totalAmount
                        ? formatMoney(l.cost.totalAmount as MoneyV2)
                        : "";
                    const bundleLabel = `${lineBags} bag${lineBags === 1 ? "" : "s"}`;
                    const linePerBagText =
                      linePricing && linePricing.perBag
                        ? formatMoney({ amount: linePricing.perBag.toFixed(2), currencyCode: lineCurrency })
                        : "";
                    return (
                      <div key={l.id} className="metal-panel rounded-2xl border border-[rgba(15,27,45,0.12)] p-4 flex gap-3 hover-lift">
                        <div
                          className="relative h-14 w-14 rounded-xl overflow-hidden border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
                          aria-hidden="true"
                        >
                          {img ? (
                            <Image
                              src={img}
                              alt={title}
                              fill
                              sizes="56px"
                              className="object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-black text-[var(--text)] leading-tight">{title}</div>
                          {variant ? (
                            <div className="text-xs text-[var(--muted)] mt-1">{variant}</div>
                          ) : null}
                          <div className="text-xs text-[var(--muted)] mt-1">
                            Bag count: {bundleLabel}
                            {linePerBagText ? ` • ${linePerBagText} / bag` : ""}
                          </div>
                          <div className="mt-2">
                            <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                          </div>
                          <div className="mt-2 text-[10px] text-[var(--muted)]">
                            Savings apply automatically at 4+ bags.
                          </div>
                        </div>
                        <div className="text-right text-sm font-black text-[var(--text)]">{lineTotal}</div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div
            className={cn(
              "flex flex-col gap-4",
              !isDrawer && "lg:sticky lg:top-24 lg:self-start"
            )}
          >
            {!isDrawer ? (
              <div className="metal-panel rounded-2xl border border-[rgba(15,27,45,0.12)] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Your bag count
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {lines.length === 0 ? (
                    <div className="text-sm text-[var(--muted)]">Your cart is empty.</div>
                  ) : (
                    lines.map((l: any) => {
                      const title = l?.merchandise?.product?.title || "Item";
                      const variant = l?.merchandise?.title || "";
                      const img =
                        l?.merchandise?.image?.url ||
                        l?.merchandise?.product?.featuredImage?.url ||
                        null;
                      const lineQty = Number(l?.quantity) || 0;
                      const bagsPerUnit = getBagsPerUnit(l?.merchandise);
                      const lineBags = bagsPerUnit * lineQty;
                      const lineCurrency = l?.cost?.totalAmount?.currencyCode || "USD";
                      const linePricing = lineBags > 0 ? pricingForQty(lineBags) : null;
                      const lineTotal = linePricing
                        ? formatMoney({ amount: linePricing.total.toFixed(2), currencyCode: lineCurrency })
                        : l.cost?.totalAmount
                          ? formatMoney(l.cost.totalAmount as MoneyV2)
                          : "";
                      const bundleLabel = `${lineBags} bag${lineBags === 1 ? "" : "s"}`;
                      const linePerBagText =
                        linePricing && linePricing.perBag
                          ? formatMoney({ amount: linePricing.perBag.toFixed(2), currencyCode: lineCurrency })
                          : "";
                      return (
                        <div key={l.id} className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3 flex gap-3">
                          <div className="media-thumb relative h-14 w-14" aria-hidden="true">
                            {img ? (
                              <Image
                                src={img}
                                alt={title}
                                fill
                                sizes="56px"
                                className="object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-black text-[var(--text)] leading-tight">{title}</div>
                            {variant ? (
                              <div className="text-xs text-[var(--muted)] mt-1">{variant}</div>
                            ) : null}
                            <div className="text-xs text-[var(--muted)] mt-1">
                              Bag count: {bundleLabel}
                              {linePerBagText ? ` • ${linePerBagText} / bag` : ""}
                            </div>
                            <div className="mt-2">
                              <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                            </div>
                            <div className="mt-2 text-[10px] text-[var(--muted)]">
                              Savings apply automatically at 4+ bags.
                            </div>
                          </div>
                          <div className="text-right text-sm font-black text-[var(--text)]">{lineTotal}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {!isDrawer ? (
              <div className="metal-panel rounded-2xl border border-[rgba(199,160,98,0.35)] p-4 flex flex-col gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Order summary
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                <span>Items</span>
                <span className="font-black text-[var(--text)]">{subtotal}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                <span>Shipping</span>
                <span className="font-semibold text-[var(--text)]">{shippingSummary}</span>
              </div>
              <div className="text-[10px] text-[var(--muted)]">{shippingHint}</div>
              <div className="flex items-center justify-between text-base text-[var(--text)]">
                <span className="font-semibold">Estimated total</span>
                <span className="font-black">{estimatedTotal}</span>
              </div>
              {bundlePricing ? (
                <div className="text-xs text-[var(--muted)]">
                  Price per bag at {totalBags} bags • {bundlePerBagText} / bag
                </div>
              ) : null}
              {bestPriceApplied ? (
                <div className="inline-flex w-fit rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]">
                  Best price applied
                </div>
              ) : null}
              {bundleSavings > 0 ? (
                <div className="text-xs text-[var(--muted)]">
                  You saved {bundleSavingsText} today vs single bags.
                </div>
              ) : null}
              {showNextTierCta ? (
                <button
                  type="button"
                  onClick={() => addBags(nextTierAddQty ?? 0)}
                  disabled={bundlePending}
                  className="btn btn-outline pressable w-full justify-center"
                >
                  {bundlePending ? "Locking in..." : nextTierCtaLabel}
                </button>
              ) : null}
              <div className="mt-2">
                {localCart?.checkoutUrl ? (
                  <div className="mb-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Express checkout
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <a
                        href={checkoutHref ?? localCart.checkoutUrl}
                        onClick={handleCheckoutClick}
                        className="rounded-full bg-[var(--navy)] px-2 py-2 text-center text-[11px] font-semibold text-white"
                      >
                        Shop Pay
                      </a>
                      <a
                        href={checkoutHref ?? localCart.checkoutUrl}
                        onClick={handleCheckoutClick}
                        className="rounded-full bg-[#111111] px-2 py-2 text-center text-[11px] font-semibold text-white"
                      >
                        Apple Pay
                      </a>
                      <a
                        href={checkoutHref ?? localCart.checkoutUrl}
                        onClick={handleCheckoutClick}
                        className="rounded-full border border-[var(--border)] bg-white px-2 py-2 text-center text-[11px] font-semibold text-[var(--text)]"
                      >
                        Google Pay
                      </a>
                    </div>
                    <div className="mt-2 text-[10px] text-[var(--muted)]">
                      Choose your payment method on the next step.
                    </div>
                  </div>
                ) : null}
                {localCart?.checkoutUrl ? (
                  <a
                    href={checkoutHref ?? localCart.checkoutUrl}
                    className="btn btn-candy w-full justify-center pressable"
                    onClick={handleCheckoutClick}
                  >
                    <span className="inline-flex items-center gap-2">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
                        />
                      </svg>
                      Secure checkout - Ships in 24 hours
                    </span>
                  </a>
                ) : null}
                <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
                  Ships in 24 hours • Easy returns
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-semibold text-[var(--muted)] sm:grid-cols-4">
                  {TRUST_ITEMS.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--text)]"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[var(--candy-red)]" aria-hidden="true">
                        <path fill="currentColor" d={item.icon} />
                      </svg>
                      <span className="leading-tight">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-2 text-[11px] text-[var(--muted)]">
                  <div className="font-semibold text-[var(--text)]">
                    ⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Review highlights updated weekly from verified buyers.
                  </div>
                </div>
                <Link
                  href={secondaryCta.href}
                  className="mt-2 inline-flex text-xs font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]"
                  onClick={onClose}
                >
                  {secondaryCta.label}
                </Link>
              </div>
              </div>
            ) : null}

            <details className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                See verified reviews
              </summary>
              <div className="mt-3">
                <ReviewHighlights variant="light" limit={2} />
              </div>
            </details>

          </div>
        </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="metal-panel rounded-[28px] border border-[rgba(15,27,45,0.12)] p-4">
            <div className="text-sm font-semibold text-[var(--text)]">Your cart is empty.</div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              Pick a bag count to get started and unlock free shipping at 5 bags.
            </div>
            <Link
              href="/shop#bundle-pricing"
              className="btn btn-candy mt-4 w-full justify-center"
              onClick={onClose}
            >
              Shop now
            </Link>
            <div className="mt-2">
              <AmazonOneBagNote className="text-[11px] text-[var(--muted)]" />
            </div>
          </div>
        </div>
      )}

      {showStickyCheckout ? (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden pointer-events-none">
          <div
            className="mx-auto max-w-6xl px-4 flex justify-end"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            {localCart?.checkoutUrl ? (
              <a
                href={checkoutHref ?? localCart.checkoutUrl}
                className="btn btn-candy btn-compact pressable pointer-events-auto shadow-[0_10px_22px_rgba(15,27,45,0.14)] min-h-[44px]"
                onClick={handleCheckoutClick}
              >
                Checkout - {subtotal}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
