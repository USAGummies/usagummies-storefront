// src/components/product/StickyAddToCartBar.tsx (FULL REPLACE)
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { GummyIcon } from "@/components/ui/GummyIcon";

type Props = {
  title: string;
  priceText: string;
  imageUrl?: string | null;
  imageAlt?: string | null;

  purchaseSelector?: string;
  addToCartSubmitId?: string;
};

export function StickyAddToCartBar({
  title,
  priceText,
  imageUrl,
  imageAlt,
  purchaseSelector = '[data-purchase-section="true"]',
  addToCartSubmitId = "add-to-cart-hidden-submit",
}: Props) {
  const [show, setShow] = useState(false);
  const alt = useMemo(() => imageAlt || title, [imageAlt, title]);

  useEffect(() => {
    const purchaseEl = document.querySelector(purchaseSelector);
    if (!purchaseEl) return;

    const getPurchaseTop = () =>
      purchaseEl.getBoundingClientRect().top + window.scrollY;

    let purchaseTop = getPurchaseTop();

    function onResize() {
      purchaseTop = getPurchaseTop();
      onScroll();
    }

    function onScroll() {
      const shouldShow = window.scrollY > purchaseTop + 200;
      setShow(shouldShow);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [purchaseSelector]);

  function handleClick() {
    trackEvent("sticky_bundle_click", { source: "shop" });
    const hiddenSubmit = document.getElementById(
      addToCartSubmitId
    ) as HTMLButtonElement | null;
    if (hiddenSubmit) {
      hiddenSubmit.click();
      return;
    }

    const purchaseEl = document.querySelector(purchaseSelector);
    if (purchaseEl) {
      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      purchaseEl.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 sm:hidden">
      <div className="mx-auto w-full max-w-6xl px-3 pb-3">
        <div className="candy-panel rounded-2xl">
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={alt}
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-[var(--text)] truncate">{title}</div>
              <div className="text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">{priceText}</span>{" "}
                <span className="text-[var(--muted)]">-</span>{" "}
                <span>Save more with more bags - {FREE_SHIPPING_PHRASE}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                <span className="rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1">Made in USA</span>
                <span className="rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1">No artificial dyes</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClick}
              className="btn btn-candy pressable"
              style={{ whiteSpace: "nowrap" }}
            >
              <span className="inline-flex items-center gap-2">
                <GummyIcon variant="red" size={14} />
                Lock in savings now
              </span>
            </button>
          </div>
          <div className="px-3 pb-3">
            <AmazonOneBagNote
              className="text-[10px] text-[var(--muted)]"
              linkClassName="underline underline-offset-4 text-[var(--text)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
