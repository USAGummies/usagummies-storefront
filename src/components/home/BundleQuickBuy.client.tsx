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

type TierKey = "5" | "8" | "12";

type Props = {
  tiers?: BundleTier[] | null;
  productHandle?: string | null;
  anchorId?: string;
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

const FEATURED_QTYS: TierKey[] = ["5", "8", "12"];

export default function BundleQuickBuy({ tiers = [], productHandle, anchorId }: Props) {
  const router = useRouter();
  const ctaRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<TierKey>("8");
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const featured = React.useMemo(() => {
    const allowed = (tiers || []).filter(
      (t) => t && FEATURED_QTYS.includes(String(t.qty) as TierKey)
    );
    allowed.sort((a, b) => a.qty - b.qty);
    return allowed;
  }, [tiers]);

  React.useEffect(() => {
    const preferred =
      featured.find((t) => t.qty === 8) ||
      featured.find((t) => t.qty === 5) ||
      featured[0];
    if (preferred) {
      setSelected(String(preferred.qty) as TierKey);
    }
  }, [featured]);

  const selectedTier =
    featured.find((t) => String(t.qty) === selected) || featured[0] || null;

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
    setSelected(String(qty) as TierKey);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.requestAnimationFrame(scrollToCTA);
    }
  }

  const hasPrice = Number.isFinite(selectedTier?.price ?? NaN);
  const ctaDisabled = !selectedTier?.variantId || !hasPrice || selectedTier?.available === false;

  async function addToCart() {
    if (!selectedTier?.variantId || ctaDisabled) {
      setError(selectedTier?.available === false ? "Out of stock" : "Select a bundle to continue.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId: selectedTier.variantId,
          merchandiseId: selectedTier.variantId,
          quantity: 1,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not add to cart.");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
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

  const tier5 = featured.find((t) => t.qty === 5);
  const baselinePerBag =
    tier5 && Number.isFinite(tier5.price ?? NaN) ? (tier5.price as number) / 5 : null;

  function savingsFor(tier: BundleTier) {
    if (!baselinePerBag || !Number.isFinite(tier.price ?? NaN)) return null;
    const baselineTotal = baselinePerBag * tier.qty;
    const s = baselineTotal - (tier.price as number);
    return s > 0 ? s : 0;
  }

  function renderRow(tier: BundleTier) {
    const isActive = String(tier.qty) === selected;
    const displayTotal =
      Number.isFinite(tier.price ?? NaN) && tier.price !== null
        ? money(tier.price, tier.currencyCode || "USD")
        : null;
    const displayPerBag =
      tier.perBag && Number.isFinite(tier.perBag)
        ? `~${money(tier.perBag, tier.currencyCode || "USD")} / bag`
        : null;
    const unavailable = tier.available === false || !displayTotal;

    const isFive = tier.qty === 5;
    const isEight = tier.qty === 8;
    const isTwelve = tier.qty === 12;

    const savings = !isFive ? savingsFor(tier) : null;
    const savingsValue =
      savings && Number.isFinite(savings) && savings > 0 ? savings : null;

    const pills: string[] = [];
    if (isFive) {
      pills.push("Free shipping");
    } else if (isEight) {
      pills.push("Most popular • Best value");
      pills.push("Free shipping");
    } else if (isTwelve) {
      pills.push("Best price per bag");
      pills.push("Free shipping");
    }

    const cardTone = isEight ? "bg-white/[0.15]" : "bg-white/[0.04]";
    const cardBorder = isEight
      ? "ring-1 ring-[rgba(212,167,75,0.82)] border-[rgba(212,167,75,0.6)] shadow-[0_26px_62px_rgba(0,0,0,0.38)]"
      : "border-[rgba(212,167,75,0.16)]";

    const canSelect = !unavailable;

    return (
      <button
        key={tier.variantId || tier.qty}
        type="button"
        aria-pressed={isActive}
        disabled={!canSelect}
        onClick={() => handleSelect(tier.qty, canSelect)}
        className={[
          "bundleTierBtn",
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
              <span className="absolute left-0 top-3 bottom-3 w-[5px] rounded-full bg-gradient-to-b from-[#d6403a] via-[var(--gold, #d4a74b)] to-[#0a3c8a] opacity-90" />
              <span className="absolute -top-2 left-3 inline-flex items-center rounded-b-xl rounded-tr-xl bg-[linear-gradient(135deg,rgba(212,167,75,0.96),rgba(214,64,58,0.82))] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.24em] text-[#0c1426] uppercase shadow-[0_8px_18px_rgba(0,0,0,0.3)]">
                Recommended
              </span>
            </>
          ) : null}
          <div
            className={[
              "bundleTierBtn__inner",
              isEight ? "pt-[22px] pb-4.5 pl-4" : "pt-3.5 pb-3 pl-3.5",
              isEight ? "bg-white/[0.035] rounded-2xl" : "",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <div
                    className={[
                      "text-white font-extrabold leading-none whitespace-nowrap",
                      isEight ? "text-xl" : "text-lg",
                    ].join(" ")}
                  >
                    {tier.qty} bags
                  </div>
                </div>
                <div className="text-xs text-white/70">
                  {tier.qty === 5
                    ? "Starter bundle"
                    : tier.qty === 8
                    ? "Most choose this"
                    : "Stock up case"}
                </div>
                {isEight ? (
                  <div className="text-[11px] text-white/70 font-semibold uppercase tracking-[0.12em]">
                    Best overall value
                  </div>
                ) : null}
                {savingsValue && (isEight || isTwelve) ? (
                  <div
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      "bg-[rgba(212,167,75,0.14)] border border-[rgba(212,167,75,0.35)] text-[var(--gold)]",
                      isEight ? "shadow-[0_10px_28px_rgba(212,167,75,0.25)]" : "shadow-[0_6px_18px_rgba(212,167,75,0.18)]",
                    ].join(" ")}
                  >
                    <span aria-hidden="true">★</span>
                    <span className="leading-none font-extrabold">
                      Save {money(savingsValue, tier.currencyCode || "USD")}
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
                  <span className="pointer-events-none absolute -inset-3 rounded-[18px] bg-[radial-gradient(circle_at_65%_20%,rgba(212,167,75,0.28),transparent_58%)] opacity-95" />
                ) : null}
                <div className="relative text-white text-xl font-extrabold leading-none drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
                  {displayTotal || "—"}
                </div>
                {displayPerBag ? (
                  <div className="relative mt-1 text-[11px] text-white/65">{displayPerBag}</div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
        className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 sm:p-5 text-white/70"
      >
        <div className="text-[11px] tracking-[0.2em] text-white/60 font-semibold uppercase">
          Bundle pricing
        </div>
        <div className="mt-2 text-sm">
          Live bundle pricing is unavailable right now. View the product page to continue.
        </div>
        <Link
          href={productHandle ? `/products/${productHandle}?focus=bundles` : "/shop"}
          className="mt-3 inline-flex items-center justify-center rounded-full bg-[#d6403a] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(214,64,58,0.35)] hover:brightness-110 active:brightness-95"
        >
          View product
        </Link>
      </section>
    );
  }

  return (
    <section
      id={anchorId}
      aria-label="Bundle pricing"
      className="relative max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/[0.06] shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl p-4 sm:p-5 pb-20 sm:pb-12 overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_10%_16%,rgba(255,255,255,0.22),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(10,60,138,0.3),transparent_44%),linear-gradient(135deg,rgba(214,64,58,0.28),rgba(212,167,75,0.18),rgba(12,20,38,0.38)),repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0,rgba(255,255,255,0.07)_8px,transparent_8px,transparent_16px)]" />
      <div className="relative mb-3 h-[2px] rounded-full bg-gradient-to-r from-[#d6403a]/70 via-white/50 to-[#0a3c8a]/65 opacity-85 shadow-[0_0_18px_rgba(255,255,255,0.12)]" />
      <div className="relative text-[10px] font-semibold tracking-[0.26em] text-white/75 uppercase flex items-center gap-2">
        <span aria-hidden="true">🇺🇸</span>
        <span>American-made bundle pricing</span>
      </div>
      <div className="relative mt-1 text-2xl font-extrabold text-white">
        Pick your bundle
      </div>
      <p className="relative mt-1.5 text-sm text-white/70 max-w-[52ch]">
        Free shipping at 5+ bags. 8 bags is the sweet spot.
      </p>

      <div className="mt-2.5 flex flex-col gap-1.25 sm:gap-2">
        {featured.map((tier) => renderRow(tier))}
      </div>

      <div
        className="mt-3 sm:mt-3.5 rounded-2xl border border-white/12 bg-white/[0.07] p-3 sm:p-4 sticky bottom-3 md:static backdrop-blur-sm"
        ref={ctaRef}
      >
        {selectedTier ? (
          <div className="flex items-start justify-between gap-3 border-b border-white/12 pb-2 mb-2">
            <div className="text-sm font-semibold text-white/90 flex items-baseline gap-1">
              <span className="text-[12px] text-white/70">
                {selectedTier.qty === 8 ? "Your best value bundle:" : "Your bundle:"}
              </span>
              <span className="text-[15px] font-extrabold text-white">{selectedTier.qty} bags</span>
            </div>
            <div className="text-right text-xs text-white/60">
              {selectedTier.perBag && Number.isFinite(selectedTier.perBag)
                ? `~${money(selectedTier.perBag, selectedTier.currencyCode || "USD")} / bag`
                : ""}
            </div>
          </div>
        ) : null}

        <div className="mt-2.5 flex flex-col gap-2">
          <button
            type="button"
            className="w-full inline-flex items-center justify-center rounded-full bg-[#d6403a] px-4 sm:px-5 py-3 text-[14px] sm:text-[15px] font-bold text-white whitespace-nowrap shadow-[0_14px_36px_rgba(214,64,58,0.4)] hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed leading-tight relative overflow-hidden"
            onClick={addToCart}
            disabled={adding || ctaDisabled}
          >
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_50%)] opacity-95" />
            <span className="relative">
              {adding
                ? "Adding…"
                : selectedTier && selectedTier.price
                ? `Add ${selectedTier.qty}-bag bundle — ${money(
                    selectedTier.price,
                    selectedTier.currencyCode || "USD"
                  )} →`
                : "Add bundle to cart →"}
            </span>
          </button>
          <div className="text-xs text-white/75">
            Free shipping • Secure checkout
          </div>
          {error ? (
            <div className="text-xs font-semibold text-red-200">{error}</div>
          ) : null}
          {ctaDisabled && !error ? (
            <div className="text-xs text-white/60">
              Pricing or inventory unavailable. View product page to continue.
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-white/70">
        <Link
          href={
            productHandle
              ? `/products/${productHandle}?focus=bundles`
              : "/shop"
          }
          className="inline-flex items-center gap-2 font-semibold text-white underline underline-offset-4 hover:text-white/90"
        >
          Explore more bundle sizes →
        </Link>
      </div>
    </section>
  );
}
