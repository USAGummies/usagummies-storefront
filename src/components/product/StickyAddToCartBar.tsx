// src/components/product/StickyAddToCartBar.tsx (FULL REPLACE)
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

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
    const hiddenSubmit = document.getElementById(
      addToCartSubmitId
    ) as HTMLButtonElement | null;
    if (hiddenSubmit) {
      hiddenSubmit.click();
      return;
    }

    const purchaseEl = document.querySelector(purchaseSelector);
    if (purchaseEl) {
      purchaseEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      {/* Ribbon */}
      <div style={{ margin: "0 10px 8px" }}>
        <PatriotRibbon />
      </div>

      <div className="mx-auto w-full max-w-6xl px-3 pb-3">
        <div
          className="patriot-banner"
          style={{
            borderRadius: 18,
          }}
        >
          <div
            className="patriot-banner__content"
            style={{
              padding: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-black/10 bg-white/60">
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
              <div
                style={{
                  fontWeight: 950,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {title}
              </div>

              <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.25 }}>
                <span style={{ fontWeight: 900 }}>{priceText}</span>{" "}
                <span style={{ opacity: 0.55 }}>•</span>{" "}
                <span style={{ opacity: 0.85 }}>
                  Bundle &amp; save — {FREE_SHIPPING_PHRASE}
                </span>
              </div>

              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge" style={{ padding: "7px 10px" }}>
                  🇺🇸 Made in USA
                </span>
                <span className="badge" style={{ padding: "7px 10px" }}>
                  ✅ Dye-free
                </span>
                <span className="badge" style={{ padding: "7px 10px" }}>
                  🚚 Ships fast
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClick}
              className="btn btn-red"
              style={{
                borderRadius: 999,
                padding: "12px 14px",
                whiteSpace: "nowrap",
                fontWeight: 950,
              }}
            >
              Add bundle →
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 420px){
          .badge{ display: none; }
        }
      `}</style>
    </div>
  );
}
