// src/components/ui/CartView.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CartLineControls } from "@/components/cart/CartLineControls.client";
import AddBagButton from "@/components/cart/AddBagButton.client";
import { cn } from "@/lib/cn";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY, MIN_PER_BAG } from "@/lib/bundles/pricing";
import { isSingleBagVariant, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { trackEvent } from "@/lib/analytics";
import { ReviewHighlights } from "@/components/reviews/ReviewHighlights";

type MoneyV2 = { amount: string; currencyCode: string };

const FEATURED_BUNDLE_QTYS = [5, 8, 12];

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

export function CartView({ cart, onClose }: { cart: any; onClose?: () => void }) {
  const [localCart, setLocalCart] = useState(cart);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [bundlePending, setBundlePending] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
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

  const lines =
    (localCart?.lines as any)?.nodes ??
    (localCart?.lines as any)?.edges?.map((e: any) => e?.node) ??
    [];

  const totalBags = lines.reduce((sum: number, l: any) => {
    const bagsPerUnit = getBagsPerUnit(l?.merchandise);
    const qty = Number(l?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
  const primaryLine =
    lines.find((l: any) => isSingleBagVariant(l?.merchandise?.id)) || lines[0] || null;
  const canUpdateLine = Boolean(primaryLine?.id && isSingleBagVariant(primaryLine?.merchandise?.id));

  const bundlePricing = totalBags > 0 ? pricingForQty(totalBags) : null;
  const summaryCurrency = localCart?.cost?.subtotalAmount?.currencyCode || "USD";
  const bundlePerBagText =
    bundlePricing ? formatNumber(bundlePricing.perBag, summaryCurrency) : "";
  const baseTotal = totalBags > 0 ? BASE_PRICE * totalBags : 0;
  const bundleSavings =
    bundlePricing && baseTotal > bundlePricing.total
      ? baseTotal - bundlePricing.total
      : 0;
  const bundleSavingsText =
    bundleSavings > 0 ? formatNumber(bundleSavings, summaryCurrency) : "";
  const subtotal = bundlePricing
    ? formatMoney({ amount: bundlePricing.total.toFixed(2), currencyCode: summaryCurrency })
    : localCart?.cost?.subtotalAmount
      ? formatMoney(localCart.cost.subtotalAmount as MoneyV2)
      : "";

  const pct = clampPct(Math.round((totalBags / FREE_SHIP_QTY) * 100));
  const unlocked = totalBags >= FREE_SHIP_QTY;
  const freeShipGap = Math.max(0, FREE_SHIP_QTY - totalBags);
  const freeShipLine = unlocked
    ? "Free shipping unlocked."
    : `Add ${freeShipGap} more bag${freeShipGap === 1 ? "" : "s"} for free shipping.`;

  const savingsGap = Math.max(0, 4 - totalBags);
  let cartHeadline = "";
  if (totalBags === 0) {
    cartHeadline = "Add bags to unlock bundle savings.";
  } else if (totalBags < 4) {
    cartHeadline = `You're ${savingsGap} bag${savingsGap === 1 ? "" : "s"} away from bundle savings.`;
  } else if (totalBags === 4) {
    cartHeadline = "Bundle savings unlocked.";
  } else if (totalBags >= 5 && totalBags < 8) {
    cartHeadline = "Free shipping unlocked.";
  } else if (totalBags === 8) {
    cartHeadline = "Great choice — our most popular bundle.";
  } else if (totalBags > 8 && totalBags < 12) {
    cartHeadline = "Bulk savings locked in.";
  } else {
    cartHeadline = "Best price per bag unlocked.";
  }
  const cartSubline = "Free shipping at 5+ bags.";

  const savingsTarget = totalBags > 0 && totalBags < 4 ? 4 : totalBags === 4 ? 5 : null;
  const savingsButtonLabel =
    totalBags > 0 && totalBags < 4
      ? `Add ${savingsGap} bag${savingsGap === 1 ? "" : "s"} to start saving`
      : totalBags === 4
        ? "Add 1 bag to unlock free shipping"
        : "";
  const showUpgradeToEight = totalBags > 0 && totalBags < 8;
  const showActionButtons = Boolean(savingsTarget || showUpgradeToEight);
  const upgradeToEightLabel = `Add 8-bag bundle - ${formatNumber(
    pricingForQty(8).total,
    summaryCurrency
  )}`;

  useEffect(() => {
    if (unlocked) {
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 900);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  async function setBundleQty(qty: number) {
    const nextQty = Math.max(1, Math.round(qty));
    if (bundlePending || nextQty === totalBags) return;
    trackEvent("cart_bundle_set", {
      qty: nextQty,
      currentQty: totalBags,
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
      const payload = canUpdateLine
        ? { action: "update", lineId: primaryLine?.id, quantity: nextQty, cartId: cartId || undefined }
        : {
            action: "replace",
            variantId: SINGLE_BAG_VARIANT_ID,
            quantity: nextQty,
            cartId: cartId || undefined,
          };
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not update bundle.");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);
      setLocalCart(json.cart ?? null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
    } catch (err: any) {
      setBundleError(err?.message || "Could not update bundle.");
    } finally {
      setBundlePending(false);
    }
  }

  const hasLines = lines.length > 0;
  const cartContext = onClose ? "drawer" : "cart";
  const isDrawer = Boolean(onClose);
  const secondaryCta = onClose
    ? { href: "/cart", label: "View cart" }
    : { href: "/shop#bundle-pricing", label: "Keep shopping" };
  const showStickyCheckout = !onClose && hasLines && Boolean(localCart?.checkoutUrl);

  function handleCheckoutClick() {
    const fallbackSubtotal = Number(localCart?.cost?.subtotalAmount?.amount || 0);
    trackEvent("checkout_click", {
      context: cartContext,
      totalBags,
      subtotal: bundlePricing?.total ?? fallbackSubtotal,
    });
    onClose?.();
  }

  return (
    <div className={cn("px-4 py-4 text-[var(--text)]", showStickyCheckout && "pb-24")}>
      {hasLines ? (
        <div
          className={cn(
            "grid gap-5",
            !onClose && "lg:grid-cols-[1.15fr_0.85fr] lg:items-start"
          )}
        >
          <div className="flex flex-col gap-4">
            <div className="metal-panel rounded-3xl border border-[rgba(199,160,98,0.35)] p-4">
              <div className="text-sm font-black text-[var(--text)]">{cartHeadline}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{cartSubline}</div>
              <div
                className={cn(
                  "mt-3 h-2 w-full overflow-hidden rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]",
                  justUnlocked && "ring-2 ring-[var(--red)]"
                )}
              >
                <div
                  className={cn(
                    "h-full bg-gradient-to-r from-[var(--red)] via-[var(--gold)] to-[var(--red)] transition-all",
                    justUnlocked && "animate-pbxPulse"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-[var(--muted)]">{freeShipLine}</div>
              {showActionButtons ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    {savingsTarget ? (
                      <AddBagButton
                        label={savingsButtonLabel}
                        pendingLabel="Updating..."
                        disabled={bundlePending}
                        onAdd={() => setBundleQty(savingsTarget as number)}
                      />
                    ) : null}
                    {showUpgradeToEight ? (
                      <AddBagButton
                        label={upgradeToEightLabel}
                        pendingLabel="Updating..."
                        disabled={bundlePending}
                        onAdd={() => setBundleQty(8)}
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
                  See bundle pricing rules
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
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Choose your bundle
                  </div>
                  <div className="text-lg font-black text-[var(--text)]">Bundle &amp; save</div>
                  <div className="text-xs text-[var(--muted)]">
                    Add more bags to lower your price per bag.
                  </div>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Current bundle:{" "}
                  <span className="font-semibold text-[var(--text)]">
                    {totalBags} bag{totalBags === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {FEATURED_BUNDLE_QTYS.map((qty) => {
                  const pricing = pricingForQty(qty);
                  const totalText = formatNumber(pricing.total, summaryCurrency);
                  const perBagText = formatNumber(pricing.perBag, summaryCurrency);
                  const savings = Math.max(0, BASE_PRICE * qty - pricing.total);
                  const savingsText = savings > 0 ? formatNumber(savings, summaryCurrency) : "";
                  const label = bundleLabel(qty);
                  const isActive = totalBags === qty;
                  const isBest = qty === 8;
                  const freeShip = qty >= FREE_SHIP_QTY;

                  return (
                    <button
                      key={qty}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setBundleQty(qty)}
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
                        <div className="text-sm font-black text-[var(--text)]">{qty} bags</div>
                        {label ? (
                          <span className="rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]">
                            {label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-xl font-black text-[var(--text)]">{totalText}</div>
                      <div className="text-[11px] text-[var(--muted)]">~{perBagText} / bag</div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[var(--candy-red)]">
                          {savingsText ? `Save ${savingsText} vs single bags` : "Standard price"}
                        </span>
                        {freeShip ? (
                          <span className="text-[var(--muted)]">Free shipping</span>
                        ) : null}
                      </div>
                      {isBest ? (
                        <div className="mt-2 text-[11px] font-semibold text-[var(--muted)]">
                          Most customers check out with 8.
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
                <div className="mt-2 text-xs text-[var(--muted)]">Updating bundle...</div>
              ) : null}
            </div>

            {isDrawer ? (
              <div className="flex flex-col gap-3">
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
                            <Image src={img} alt={title} fill className="object-cover" />
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-black text-[var(--text)] leading-tight">{title}</div>
                          {variant ? (
                            <div className="text-xs text-[var(--muted)] mt-1">{variant}</div>
                          ) : null}
                          <div className="text-xs text-[var(--muted)] mt-1">
                            Bundle: {bundleLabel}
                            {linePerBagText ? ` • ${linePerBagText} / bag` : ""}
                          </div>
                          <div className="mt-2">
                            <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                          </div>
                          <div className="mt-2 text-[10px] text-[var(--muted)]">
                            Bundles apply automatically at 4+ bags.
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
                  Your bundle
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
                          <div
                            className="relative h-14 w-14 rounded-xl overflow-hidden border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
                            aria-hidden="true"
                          >
                            {img ? (
                              <Image src={img} alt={title} fill className="object-cover" />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-black text-[var(--text)] leading-tight">{title}</div>
                            {variant ? (
                              <div className="text-xs text-[var(--muted)] mt-1">{variant}</div>
                            ) : null}
                            <div className="text-xs text-[var(--muted)] mt-1">
                              Bundle: {bundleLabel}
                              {linePerBagText ? ` • ${linePerBagText} / bag` : ""}
                            </div>
                            <div className="mt-2">
                              <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                            </div>
                            <div className="mt-2 text-[10px] text-[var(--muted)]">
                              Bundles apply automatically at 4+ bags.
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

            <div className="metal-panel rounded-2xl border border-[rgba(199,160,98,0.35)] p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                <span>Subtotal</span>
                <span className="font-black text-[var(--text)]">{subtotal}</span>
              </div>
              {bundlePricing ? (
                <div className="text-xs text-[var(--muted)]">
                  Bundle pricing: {totalBags} bags • {bundlePerBagText} / bag
                </div>
              ) : null}
              {bundleSavings > 0 ? (
                <div className="text-xs text-[var(--muted)]">
                  Save {bundleSavingsText} vs single bags.
                </div>
              ) : null}
              <div className="mt-2">
                {localCart?.checkoutUrl ? (
                  <a
                    href={localCart.checkoutUrl}
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
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Ships in 24 hours 🇺🇸
                </div>
                <Link
                  href={secondaryCta.href}
                  className="mt-2 inline-flex text-xs font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]"
                  onClick={onClose}
                >
                  {secondaryCta.label}
                </Link>
              </div>
              <div className="mt-3 grid gap-1 text-xs text-[var(--muted)]">
                <div>Love it or your money back</div>
                <div>Ships within 24 hours</div>
                <div>Made in the USA</div>
              </div>
            </div>

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
      ) : (
        <div className="flex flex-col gap-4">
          <div className="metal-panel rounded-[28px] border border-[rgba(15,27,45,0.12)] p-4">
            <div className="text-sm font-semibold text-[var(--text)]">Your cart is empty.</div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              Pick a bundle to get started and unlock free shipping at 5 bags.
            </div>
            <Link
              href="/shop#bundle-pricing"
              className="btn btn-candy mt-4 w-full justify-center"
              onClick={onClose}
            >
              Build my bundle
            </Link>
          </div>
        </div>
      )}

      {showStickyCheckout ? (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden">
          <div className="mx-auto max-w-6xl px-4 pb-4">
            <div className="metal-panel rounded-2xl border border-[rgba(15,27,45,0.12)] px-4 py-3 text-[var(--text)] shadow-[0_16px_36px_rgba(15,27,45,0.18)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--muted)]">
                  Subtotal
                  <div className="text-sm font-black text-[var(--text)]">{subtotal}</div>
                </div>
                {localCart?.checkoutUrl ? (
                  <a
                    href={localCart.checkoutUrl}
                    className="btn btn-candy pressable"
                    onClick={handleCheckoutClick}
                  >
                    Secure checkout - Ships in 24 hours
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
