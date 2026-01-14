// src/components/ui/CartView.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CartLineControls } from "@/components/cart/CartLineControls.client";
import AddBagButton from "@/components/cart/AddBagButton.client";
import { cn } from "@/lib/cn";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
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

  let cartNudge = "";
  let cartNudgeDetail = "";
  let nudgeActionQty: number | null = null;
  let nudgeActionLabel = "";
  if (totalBags > 0 && totalBags < 4) {
    const needed = 4 - totalBags;
    cartNudge = `Add ${needed} more bag${needed === 1 ? "" : "s"} to start saving.`;
    nudgeActionQty = 4;
    nudgeActionLabel = `Add ${needed} bag${needed === 1 ? "" : "s"} to start saving`;
    const pricingAtFour = pricingForQty(4);
    const savingsAtFour = Math.max(0, BASE_PRICE * 4 - pricingAtFour.total);
    if (savingsAtFour > 0) {
      cartNudgeDetail = `Savings start at ${formatNumber(savingsAtFour, summaryCurrency)} off standard pricing.`;
    }
  } else if (totalBags === 4) {
    cartNudge = "Add 1 more bag to get free shipping.";
    nudgeActionQty = 5;
    nudgeActionLabel = "Add 1 bag for free shipping";
  } else if (totalBags >= 5 && totalBags < 8) {
    cartNudge = "Most customers choose 8 bags for better value.";
    nudgeActionQty = 8;
    nudgeActionLabel = "Upgrade to 8 bags";
    const pricingAtEight = pricingForQty(8);
    const savingsAtEight = Math.max(0, BASE_PRICE * 8 - pricingAtEight.total);
    const savingsAtCurrent = Math.max(0, BASE_PRICE * totalBags - (bundlePricing?.total || 0));
    const extraSavings = Math.max(0, savingsAtEight - savingsAtCurrent);
    if (extraSavings > 0) {
      cartNudgeDetail = `Save ${formatNumber(extraSavings, summaryCurrency)} more at 8 bags.`;
    }
  } else if (totalBags === 8) {
    cartNudge = "Great choice — our most popular bundle.";
    if (bundleSavingsText) {
      cartNudgeDetail = `You're saving ${bundleSavingsText}.`;
    }
  } else if (totalBags > 8) {
    cartNudge = "Bulk savings locked in.";
    if (bundleSavingsText) {
      cartNudgeDetail = `You're saving ${bundleSavingsText}.`;
    }
  }
  const cartNudgeSecondary =
    cartNudgeDetail ||
    (unlocked ? "Free shipping unlocked." : "Free shipping unlocks at 5 bags.");

  let upgradeTarget: number | null = null;
  let upgradeTitle = "Bundle locked";
  let upgradeDetail = "You're locked in at bundle pricing.";
  if (totalBags < 5) {
    upgradeTarget = 5;
    upgradeTitle = "Unlock free shipping";
    upgradeDetail = "Move to 5 bags and ship free.";
  } else if (totalBags < 8) {
    upgradeTarget = 8;
    upgradeTitle = "Most popular bundle";
    upgradeDetail = "Best balance of value + convenience.";
  } else if (totalBags < 12) {
    upgradeTarget = 12;
    upgradeTitle = "Bulk savings option";
    upgradeDetail = "Stock up for the lowest per-bag price.";
  }
  const upgradePricing = upgradeTarget ? pricingForQty(upgradeTarget) : null;
  const upgradeTotalText =
    upgradeTarget && upgradePricing ? formatNumber(upgradePricing.total, summaryCurrency) : "";
  const upgradePerBagText =
    upgradeTarget && upgradePricing ? formatNumber(upgradePricing.perBag, summaryCurrency) : "";
  const upgradeSavings =
    upgradeTarget && upgradePricing
      ? Math.max(0, BASE_PRICE * upgradeTarget - upgradePricing.total)
      : 0;
  const upgradeSavingsText = upgradeSavings > 0 ? formatNumber(upgradeSavings, summaryCurrency) : "";

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
    <div className={cn("px-4 py-4 text-white", showStickyCheckout && "pb-24")}>
      {hasLines ? (
        <div
          className={cn(
            "grid gap-5",
            !onClose && "lg:grid-cols-[1.15fr_0.85fr] lg:items-start"
          )}
        >
          <div className="flex flex-col gap-4">
            <div className="metal-panel rounded-3xl border border-[rgba(199,160,98,0.35)] p-4">
              <div className="text-sm font-black text-white">
                {cartNudge || FREE_SHIPPING_PHRASE}
              </div>
              <div className="mt-1 text-xs text-white/70">
                {cartNudgeSecondary}
              </div>
              <div
                className={cn(
                  "mt-3 h-2 w-full overflow-hidden rounded-full border border-white/15 bg-white/10",
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
              {nudgeActionQty ? (
                <div className="mt-3 flex gap-2 flex-wrap">
                  <AddBagButton
                    label={nudgeActionLabel || "Add bags"}
                    pendingLabel="Updating..."
                    disabled={bundlePending}
                    onAdd={() => setBundleQty(nudgeActionQty as number)}
                  />
                  <Link
                    href="/shop#product-bundles"
                    className="btn btn-outline-white pressable"
                    onClick={onClose}
                  >
                    Browse bundles
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="metal-panel rounded-[32px] border border-[rgba(199,160,98,0.35)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    Pick your bundle
                  </div>
                  <div className="text-lg font-black text-white">Choose your bundle</div>
                  <div className="text-xs text-white/65">
                    Discounts start at 4 bags. Free shipping at 5+ bags. Most customers choose 8.
                  </div>
                </div>
                <div className="text-xs text-white/60">
                  Current bundle:{" "}
                  <span className="font-semibold text-white">
                    {totalBags} bag{totalBags === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                  How pricing works
                </div>
                <ul className="mt-1.5 space-y-1">
                  <li>Discounts start at 4 bags</li>
                  <li>Free shipping at 5+ bags</li>
                  <li>Most customers choose 8 bags</li>
                </ul>
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
                        "bg-[linear-gradient(180deg,rgba(10,16,30,0.96),rgba(8,12,24,0.92))] text-white",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(199,160,98,0.45)]",
                        "transition-transform",
                        isActive
                          ? "border-[rgba(199,160,98,0.7)] shadow-[0_18px_46px_rgba(7,12,20,0.6)] ring-1 ring-[rgba(199,160,98,0.45)]"
                          : "border-white/15 hover:border-[rgba(199,160,98,0.4)] hover:shadow-[0_14px_36px_rgba(7,12,20,0.5)]",
                        isBest && "scale-[1.03] sm:scale-[1.04] z-10",
                        bundlePending && !isActive && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-2xl border border-white/10" />
                      <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_55%)]" />
                      {isBest ? (
                        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#c7362c] via-[#c7a062] to-[#c7362c] opacity-90" />
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-black text-white">{qty} bags</div>
                        {label ? (
                          <span className="rounded-full border border-white/20 bg-[rgba(199,54,44,0.22)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
                            {label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-base font-black text-white">{totalText}</div>
                      <div className="text-[11px] text-white/60">~{perBagText} / bag</div>
                      {isBest ? (
                        <div className="text-[11px] text-[var(--gold)]/90">
                          Best balance of value + convenience
                        </div>
                      ) : null}
                      {savingsText ? (
                        <div className="mt-1 text-[11px] font-semibold text-[var(--gold)]">
                          Save {savingsText}
                        </div>
                      ) : null}
                      {freeShip ? (
                        <div className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/80">
                          Free shipping
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
                <div className="mt-2 text-xs text-white/60">Updating bundle...</div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              {lines.length === 0 ? (
                <div className="metal-panel rounded-2xl border border-white/12 p-4 text-sm text-white/70">
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
                    <div key={l.id} className="metal-panel rounded-2xl border border-white/10 p-4 flex gap-3 hover-lift">
                      <div
                        className="relative h-14 w-14 rounded-xl overflow-hidden border border-white/10 bg-white/5"
                        aria-hidden="true"
                      >
                        {img ? (
                          <Image src={img} alt={title} fill className="object-cover" />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-white leading-tight">{title}</div>
                        {variant ? (
                          <div className="text-xs text-white/60 mt-1">{variant}</div>
                        ) : null}
                        <div className="text-xs text-white/60 mt-1">
                          Bundle: {bundleLabel}
                          {linePerBagText ? ` • ${linePerBagText} / bag` : ""}
                        </div>
                        <div className="mt-2">
                          <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                        </div>
                      </div>
                      <div className="text-right text-sm font-black text-white">{lineTotal}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="metal-panel rounded-2xl border border-[rgba(199,160,98,0.35)] p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm text-white/70">
                <span>Subtotal</span>
                <span className="font-black text-white">{subtotal}</span>
              </div>
              {bundlePricing ? (
                <div className="text-xs text-white/60">
                  Bundle pricing: {totalBags} bags • {bundlePerBagText} / bag
                </div>
              ) : null}
              {bundleSavings > 0 ? (
                <div className="text-xs text-white/60">
                  You save {bundleSavingsText} vs single-bag pricing.
                </div>
              ) : null}
              <div className="flex items-center gap-2 flex-wrap">
                {localCart?.checkoutUrl ? (
                  <a
                    href={localCart.checkoutUrl}
                    className="btn btn-red w-full justify-center pressable"
                    onClick={handleCheckoutClick}
                  >
                    Secure checkout →
                  </a>
                ) : null}
                <Link
                  href={secondaryCta.href}
                  className="btn btn-outline-white w-full justify-center pressable"
                  onClick={onClose}
                >
                  {secondaryCta.label}
                </Link>
              </div>
              {totalBags > 0 && totalBags < 8 ? (
                <div className="text-xs text-white/60">
                  Most customers check out with 8 bags.
                </div>
              ) : null}
            </div>

            <div className="metal-panel rounded-2xl border border-white/12 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    Bundle upgrade
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{upgradeTitle}</div>
                  <div className="text-xs text-white/60">{upgradeDetail}</div>
                </div>
                {upgradeTarget ? (
                  <div className="text-right text-xs text-white/65">
                    <div className="font-semibold text-white">{upgradeTotalText}</div>
                    <div>~{upgradePerBagText} / bag</div>
                  </div>
                ) : null}
              </div>
              {upgradeTarget ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent("cart_upgrade_click", {
                        targetQty: upgradeTarget,
                        currentQty: totalBags,
                        context: cartContext,
                      });
                      setBundleQty(upgradeTarget as number);
                    }}
                    disabled={bundlePending}
                    className={cn(
                      "btn btn-outline-white pressable",
                      bundlePending && "opacity-70 pointer-events-none"
                    )}
                  >
                    Upgrade to {upgradeTarget} bags
                  </button>
                  {upgradeSavingsText ? (
                    <span className="text-xs text-[var(--gold)]">
                      Save {upgradeSavingsText}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 text-xs text-white/60">
                  Secure checkout to lock in your current pricing.
                </div>
              )}
            </div>

            <div className="metal-panel rounded-2xl border border-white/12 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                Trust & shipping
              </div>
              <div className="mt-2 grid gap-2 text-xs text-white/70 sm:grid-cols-2">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Love it or your money back</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Ships within 24 hours</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Secure checkout</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Free shipping on 5+ bags</div>
              </div>
            </div>

            <ReviewHighlights variant="dark" limit={2} />

          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="metal-panel rounded-[28px] border border-white/12 p-4">
            <div className="text-sm font-semibold text-white">Your cart is empty.</div>
            <div className="mt-2 text-xs text-white/70">
              Pick a bundle to get started and unlock free shipping at 5 bags.
            </div>
            <Link
              href="/shop#bundle-pricing"
              className="btn btn-red mt-4 w-full justify-center"
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
            <div className="metal-panel rounded-2xl border border-white/12 px-4 py-3 text-white shadow-[0_18px_40px_rgba(7,12,20,0.45)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/60">
                  Subtotal
                  <div className="text-sm font-black text-white">{subtotal}</div>
                </div>
                {localCart?.checkoutUrl ? (
                  <a
                    href={localCart.checkoutUrl}
                    className="btn btn-red pressable"
                    onClick={handleCheckoutClick}
                  >
                    Secure checkout →
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
