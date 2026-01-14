"use client";

/**
 * CANONICAL / DO NOT MODIFY WITHOUT APPROVAL
 * -------------------------------------------------------------------------
 * This BundleQuickBuy module (UI, design language, copy, pricing presentation,
 * pill/tier mapping, savings framing, sticky CTA behavior) is the standard
 * USA Gummies conversion surface for homepage/shop/PDP/cart contexts.
 * Only bug fixes, accessibility fixes, or explicitly approved strategy changes
 * may alter structure, styling, or copy. Treat any stylistic/structural edits
 * as a breaking change requiring explicit approval.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BundleTier } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";

type TierKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";

type Props = {
  tiers?: BundleTier[] | null;
  productHandle?: string | null;
  anchorId?: string;
  singleBagVariantId?: string | null;
  availableForSale?: boolean;
  variant?: "default" | "compact";
  featuredQuantities?: number[];
};

function money(amount?: number | null, currency = "USD") {
  if (!Number.isFinite(amount ?? NaN)) return null;
  const n = amount as number;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
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

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

const FEATURED_QTYS: TierKey[] = ["1", "2", "3", "4", "5", "8", "12"];
const FEATURED_QTYS_COMPACT: TierKey[] = ["5", "8", "12"];

export default function BundleQuickBuy({
  tiers = [],
  productHandle: _productHandle,
  anchorId,
  singleBagVariantId,
  availableForSale = true,
  featuredQuantities,
  variant = "default",
}: Props) {
  const router = useRouter();
  const ctaRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<TierKey>("8");
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const isCompact = variant === "compact";

  const featured = React.useMemo(() => {
    const defaultKeys = isCompact ? FEATURED_QTYS_COMPACT : FEATURED_QTYS;
    const allowedKeys = (featuredQuantities?.length
      ? featuredQuantities.map((q) => String(q))
      : defaultKeys) as TierKey[];
    const allowedSet = new Set(allowedKeys);

    const allowed = (tiers || []).filter((t) => {
      if (!t) return false;
      const key = String(t.quantity) as TierKey;
      return allowedSet.has(key);
    });
    allowed.sort((a, b) => a.quantity - b.quantity);
    return allowed;
  }, [tiers, isCompact, featuredQuantities]);

  React.useEffect(() => {
    const preferred =
      featured.find((t) => t.quantity === 8) ||
      featured.find((t) => t.quantity === 5) ||
      featured[0];
    if (preferred) {
      setSelected(String(preferred.quantity) as TierKey);
    }
  }, [featured]);

  const selectedTier =
    featured.find((t) => String(t.quantity) === selected) || featured[0] || null;

  function scrollToCTA() {
    if (!ctaRef.current) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ctaRef.current.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      block: "center",
    });
  }

  function handleSelect(qty: number, canSelect = true) {
    if (!canSelect) return;
    trackEvent("bundle_select", {
      qty,
      variant,
      anchorId: anchorId || null,
    });
    setSelected(String(qty) as TierKey);
    setSuccess(false);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.requestAnimationFrame(scrollToCTA);
    }
  }

  const hasPrice = Number.isFinite(selectedTier?.totalPrice ?? NaN);
  const ctaDisabled = !singleBagVariantId || !hasPrice || availableForSale === false;

  React.useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => setSuccess(false), 2200);
    return () => window.clearTimeout(t);
  }, [success]);

  async function addToCart() {
    const qty = selectedTier?.quantity ?? 0;
    if (!singleBagVariantId || ctaDisabled || !qty) {
      setError(availableForSale === false ? "Out of stock" : "Select a bundle to continue.");
      return;
    }
    trackEvent("bundle_add_to_cart", {
      qty,
      variant,
      anchorId: anchorId || null,
    });
    setAdding(true);
    setError(null);
    setSuccess(false);
    try {
      const storedCartId = getStoredCartId();
      if (storedCartId && typeof document !== "undefined") {
        document.cookie = `cartId=${storedCartId}; path=/; samesite=lax`;
      }
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          variantId: singleBagVariantId,
          merchandiseId: singleBagVariantId,
          quantity: qty,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not add to cart.");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      setSuccess(true);
      router.refresh();
      if (typeof window !== "undefined") {
        const prefersReduced =
          window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!prefersReduced) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      router.push("/cart");
    } catch (e: any) {
      setError(e?.message || "Could not add to cart.");
    } finally {
      setAdding(false);
    }
  }

  function savingsFor(tier: BundleTier) {
    if (!Number.isFinite(tier.totalPrice ?? NaN)) return null;
    const s = BASE_PRICE * tier.quantity - (tier.totalPrice as number);
    return s > 0 ? s : 0;
  }

  function renderRow(tier: BundleTier) {
    const isActive = String(tier.quantity) === selected;
    const displayTotal =
      Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null
        ? money(tier.totalPrice, "USD")
        : null;
    const displayPerBag =
      tier.perBagPrice && Number.isFinite(tier.perBagPrice)
        ? `~${money(tier.perBagPrice, "USD")} / bag`
        : null;
    const unavailable = availableForSale === false || !displayTotal;
    const savings = savingsFor(tier);
    const savingsValue =
      savings && Number.isFinite(savings) && savings > 0 ? savings : null;

    if (isCompact) {
      const isFive = tier.quantity === 5;
      const isEight = tier.quantity === 8;
      const isTwelve = tier.quantity === 12;
      const canSelect = !unavailable;
      const showFreeShipping = tier.quantity >= 5;
      const label =
        isEight ? "Best value" : isFive ? "Most popular" : isTwelve ? "Best price" : "";
      return (
        <button
          key={tier.quantity}
          type="button"
          aria-pressed={isActive}
          disabled={!canSelect}
          onClick={() => handleSelect(tier.quantity, canSelect)}
          className={[
            "relative min-w-[170px] sm:min-w-[190px] snap-start rounded-2xl border px-3 py-2 text-left transition overflow-hidden",
            "bg-[linear-gradient(180deg,rgba(10,16,30,0.96),rgba(8,12,24,0.92))] text-white",
            isActive
              ? "border-[rgba(199,160,98,0.7)] shadow-[0_18px_46px_rgba(7,12,20,0.6)] ring-1 ring-[rgba(199,160,98,0.45)]"
              : "border-white/15 hover:border-[rgba(199,160,98,0.4)] hover:shadow-[0_14px_36px_rgba(7,12,20,0.5)]",
            isEight ? "ring-1 ring-[rgba(199,160,98,0.45)]" : "",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(199,160,98,0.45)]",
            unavailable ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        >
          <span className="pointer-events-none absolute inset-0 rounded-2xl border border-white/10" />
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_55%)]" />
          {isEight ? (
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#c7362c] via-[#c7a062] to-[#c7362c] opacity-90" />
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-white">{tier.quantity} bags</div>
            {label ? (
              <span className="rounded-full border border-white/20 bg-[rgba(199,54,44,0.22)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
                {label}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-base font-black text-white">
            {displayTotal || "—"}
          </div>
          <div className="text-[11px] text-white/60">
            {displayPerBag || "Standard price"}
          </div>
          {savingsValue ? (
            <div className="text-[11px] font-semibold text-[var(--gold)]">
              Save {money(savingsValue, "USD")}
            </div>
          ) : null}
          {showFreeShipping ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/80">
              Free shipping
            </div>
          ) : null}
        </button>
      );
    }

    const isFive = tier.quantity === 5;
    const isEight = tier.quantity === 8;
    const isTwelve = tier.quantity === 12;
    const isSmall = tier.quantity < 5;

    const pills: string[] = [];
    if (isFive) {
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isEight) {
      pills.push("Most popular • Best value");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isTwelve) {
      pills.push("Best price per bag");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isSmall) {
      pills.push("Standard price");
    }

    const cardTone = isEight ? "bg-white/[0.15]" : "bg-white/[0.04]";
    const cardBorder = isEight
      ? "ring-1 ring-[rgba(212,167,75,0.82)] border-[rgba(212,167,75,0.6)] shadow-[0_26px_62px_rgba(0,0,0,0.38)]"
      : "border-[rgba(212,167,75,0.16)]";

    const canSelect = !unavailable;

    return (
      <button
        key={tier.quantity}
        type="button"
        aria-pressed={isActive}
        disabled={!canSelect}
        onClick={() => handleSelect(tier.quantity, canSelect)}
        className={[
          "bundleTierBtn",
          "min-w-[220px] sm:min-w-[240px] snap-start",
          cardTone,
          isActive
            ? "bundleTierBtn--active ring-1 ring-[rgba(212,167,75,0.8)] shadow-[0_18px_46px_rgba(0,0,0,0.32)]"
            : "bundleTierBtn--highlight",
          isEight ? "bundleTierBtn--primary" : "",
          cardBorder,
          unavailable ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <div className="relative">
          {isEight ? (
            <>
              <span className="absolute left-0 top-3 bottom-3 w-[4px] rounded-full bg-gradient-to-b from-[#d6403a] via-[var(--gold, #d4a74b)] to-[#0a3c8a] opacity-90" />
              <span className="absolute -top-2 left-3 inline-flex items-center rounded-b-xl rounded-tr-xl bg-[linear-gradient(135deg,rgba(212,167,75,0.96),rgba(214,64,58,0.82))] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.24em] text-[#0c1426] uppercase shadow-[0_8px_18px_rgba(0,0,0,0.3)]">
                Recommended
              </span>
            </>
          ) : null}
          <div
            className={[
              "bundleTierBtn__inner",
              isEight ? "pt-[22px] pb-4 pl-4" : "pt-4 pb-3.5 pl-4",
              isEight ? "bg-white/[0.035] rounded-2xl" : "",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-white font-extrabold leading-none whitespace-nowrap text-lg">
                  {tier.quantity} bags
                </div>
                <div className="text-xs text-white/70">
                  {tier.quantity === 5
                    ? "Most popular"
                    : tier.quantity === 8
                    ? "Best value"
                    : tier.quantity === 12
                    ? "Lowest per-bag"
                    : tier.quantity < 5
                    ? "Standard price"
                    : "Bundle savings"}
                </div>
                {savingsValue ? (
                  <div
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      "bg-[rgba(212,167,75,0.14)] border border-[rgba(212,167,75,0.35)] text-[var(--gold)]",
                      isEight ? "shadow-[0_10px_28px_rgba(212,167,75,0.25)]" : "shadow-[0_6px_18px_rgba(212,167,75,0.18)]",
                    ].join(" ")}
                    title="Savings vs the 5-bag baseline"
                  >
                    <span aria-hidden="true">★</span>
                    <span className="leading-none font-extrabold">
                      Save {money(savingsValue, "USD")}
                    </span>
                    <span className="text-[10px] text-white/65 whitespace-nowrap">(vs 5-bag)</span>
                  </div>
                ) : null}
                {unavailable ? (
                  <div className="text-[11px] text-red-200 font-semibold">Temporarily unavailable</div>
                ) : null}
              </div>
              <div className="relative text-right">
                {isEight ? (
                  <span className="pointer-events-none absolute -inset-3 rounded-[18px] bg-[radial-gradient(circle_at_65%_20%,rgba(212,167,75,0.26),transparent_58%)] opacity-95" />
                ) : null}
                <div className="relative text-white text-xl font-extrabold leading-none drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)] transition-all duration-300">
                  {displayTotal || "—"}
                </div>
                {displayPerBag ? (
                  <div className="relative mt-1 text-[11px] text-white/65 transition-all duration-300">
                    {displayPerBag}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {pills.slice(0, 2).map((p) => (
                <span
                  key={p}
                  className="bundlePill px-2.25 py-1 text-[10.5px] font-semibold tracking-tight bg-white/16 border-[rgba(255,255,255,0.32)] text-white/90 shadow-[0_4px_10px_rgba(0,0,0,0.16)]"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </button>
    );
  }

  if (!featured.length) {
    return (
      <section
        id={anchorId}
        className={[
          "rounded-3xl border p-4 sm:p-5",
          isCompact
            ? "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
            : "border-white/10 bg-white/[0.06] text-white/70",
        ].join(" ")}
      >
        <div
          className={[
            "text-[11px] tracking-[0.2em] font-semibold uppercase",
            isCompact ? "text-[var(--muted)]" : "text-white/60",
          ].join(" ")}
        >
          Bundle pricing
        </div>
        <div className="mt-2 text-sm">
          Bundle pricing is temporarily unavailable right now. Please try again or view product details.
        </div>
        <Link
          href="/shop#product-details"
          className="mt-3 inline-flex items-center justify-center rounded-full bg-[#d6403a] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(214,64,58,0.35)] hover:brightness-110 active:brightness-95"
        >
          View product details
        </Link>
      </section>
    );
  }

  return (
    <section
      id={anchorId}
      aria-label="Bundle pricing"
      className={[
        "relative mx-auto rounded-3xl border p-4 sm:p-5 overflow-hidden",
        isCompact ? "max-w-2xl" : "max-w-3xl",
        isCompact
          ? "border-white/15 bg-[rgba(10,16,30,0.92)] text-white shadow-[0_24px_60px_rgba(7,12,20,0.45)]"
          : "border-white/10 bg-white/[0.06] shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl pb-16 sm:pb-12",
      ].join(" ")}
    >
      {isCompact ? null : (
        <div className="pointer-events-none absolute inset-0 opacity-12 bg-[radial-gradient(circle_at_10%_16%,rgba(255,255,255,0.22),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(10,60,138,0.3),transparent_44%),linear-gradient(135deg,rgba(214,64,58,0.18),rgba(12,20,38,0.38)),repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0,rgba(255,255,255,0.07)_8px,transparent_8px,transparent_16px)]" />
      )}
      {isCompact ? null : (
        <div className="relative mb-3 h-[2px] rounded-full bg-gradient-to-r from-[#d6403a]/70 via-white/60 to-[#0a3c8a]/65 opacity-85 shadow-[0_0_18px_rgba(255,255,255,0.12)]" />
      )}
      <div
        className={[
          "relative text-[10px] font-semibold tracking-[0.26em] uppercase flex items-center gap-2",
          isCompact ? "text-white/70" : "text-white/75",
        ].join(" ")}
      >
        <span aria-hidden="true">🇺🇸</span>
        <span>American-made bundle pricing</span>
      </div>
      <div
        className={[
          "relative mt-1 font-extrabold",
          isCompact ? "text-2xl text-white" : "text-2xl text-white",
        ].join(" ")}
      >
        Pick your bundle
      </div>
      <p
        className={[
          "relative mt-1.5 text-sm max-w-[52ch]",
          isCompact ? "text-white/65" : "text-white/70",
        ].join(" ")}
      >
        {FREE_SHIPPING_PHRASE}. 8 bags is the sweet spot.
      </p>
      {isCompact ? null : (
        <div className="relative mt-2 text-xs text-white/75 font-semibold">
          ★★★★★ Rated by verified buyers
          <span className="ml-2 text-white/45" title="Ratings pulled from verified buyers only">
            ⓘ
          </span>
        </div>
      )}

      <div className="relative mt-3">
        {isCompact ? null : (
          <>
            <div
              className={[
                "pointer-events-none absolute left-0 top-0 h-full w-10",
                "bg-[linear-gradient(90deg,rgba(12,20,38,0.9),transparent)]",
              ].join(" ")}
            />
            <div
              className={[
                "pointer-events-none absolute right-0 top-0 h-full w-10",
                "bg-[linear-gradient(270deg,rgba(12,20,38,0.9),transparent)]",
              ].join(" ")}
            />
          </>
        )}
        <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 pr-4 bundle-slider">
          {featured.map((tier) => renderRow(tier))}
        </div>
      </div>

      <div
        className={[
          "mt-4 rounded-2xl border p-3 sm:p-4",
          isCompact
            ? "border-white/15 bg-[rgba(12,18,32,0.92)]"
            : "border-white/12 bg-white/[0.07] sticky bottom-3 md:static backdrop-blur-sm",
        ].join(" ")}
        ref={ctaRef}
      >
        {selectedTier ? (
          <div
            className={[
              "flex items-center justify-between gap-3",
              isCompact ? "" : "border-b border-white/12 pb-2 mb-2",
            ].join(" ")}
          >
            <div className={isCompact ? "text-sm font-semibold text-white/80" : "text-sm font-semibold text-white/90"}>
              {selectedTier.quantity === 8 ? "Your best value bundle:" : "Your bundle:"}{" "}
              <span className={isCompact ? "font-extrabold text-white" : "font-extrabold text-white"}>
                {selectedTier.quantity} bags
              </span>
            </div>
            <div className={isCompact ? "text-right text-sm font-bold text-white" : "text-right text-xs text-white/60"}>
              <div
                key={`${selectedTier.quantity}-${selectedTier.totalPrice}`}
                className={isCompact ? "text-base font-extrabold" : "text-[12px] font-semibold text-white/80 transition-all duration-300 price-pop"}
              >
                {selectedTier.totalPrice && Number.isFinite(selectedTier.totalPrice)
                  ? money(selectedTier.totalPrice, "USD")
                  : "—"}
              </div>
              {isCompact ? null : selectedTier.perBagPrice && Number.isFinite(selectedTier.perBagPrice) ? (
                <div
                  key={`${selectedTier.quantity}-${selectedTier.perBagPrice}`}
                  className="price-pop"
                >
                  {`~${money(selectedTier.perBagPrice, "USD")} / bag`}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-2.5 flex flex-col gap-2">
          <button
            type="button"
            className={[
              "w-full inline-flex items-center justify-center rounded-full px-4 sm:px-5 py-3 text-[14px] sm:text-[15px] font-bold whitespace-nowrap shadow-[0_14px_36px_rgba(214,64,58,0.28)] hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed leading-tight relative overflow-hidden",
              isCompact ? "bg-[var(--red)] text-white" : "bg-[#d6403a] text-white",
            ].join(" ")}
            onClick={addToCart}
            disabled={adding || ctaDisabled}
          >
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_50%)] opacity-95" />
            <span className="relative inline-flex items-center gap-2">
              {adding ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                  />
                  Adding…
                </>
              ) : selectedTier && selectedTier.totalPrice ? (
                `Add ${selectedTier.quantity}-bag bundle — ${money(selectedTier.totalPrice, "USD")} →`
              ) : (
                "Add bundle to cart →"
              )}
            </span>
          </button>
          <div className={isCompact ? "text-xs text-white/70" : "text-xs text-white/75"}>
            {FREE_SHIPPING_PHRASE} • Secure checkout
          </div>
          {error ? (
            <div className={isCompact ? "text-xs font-semibold text-red-200" : "text-xs font-semibold text-red-200"}>{error}</div>
          ) : null}
          {success && !error ? (
            <div className={isCompact ? "text-xs font-semibold text-[var(--gold)]" : "text-xs font-semibold text-[var(--gold)]"}>
              Added to cart.
            </div>
          ) : null}
          {ctaDisabled && availableForSale === false && !error ? (
            <div className={isCompact ? "text-xs text-white/50" : "text-xs text-white/60"}>Out of stock.</div>
          ) : null}
        </div>
      </div>

      <div className={isCompact ? "mt-3 flex items-center gap-3 text-xs text-white/60" : "mt-3 flex items-center gap-3 text-xs text-white/70"}>
        <Link
          href="/shop#product-bundles"
          className={isCompact ? "inline-flex items-center gap-2 font-semibold text-white/80 underline underline-offset-4 hover:text-white" : "inline-flex items-center gap-2 font-semibold text-white underline underline-offset-4 hover:text-white/90"}
        >
          Explore more bundle sizes →
        </Link>
      </div>
    </section>
  );
}
