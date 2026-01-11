"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type QuickViewProps = {
  product: any;
  href: string;
  children?: (open: () => void) => React.ReactNode;
};

export default function QuickView({ product, href, children }: QuickViewProps) {
  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const img = product?.featuredImage;
  const description = product?.description || "";

  return (
    <>
      {children ? (
        children(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-white/70 underline underline-offset-4 hover:text-white"
        >
          Quick view
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="mx-auto w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#0c1426] p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-white">Quick view</div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.2fr]">
              <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                {img?.url ? (
                  <Image
                    src={img.url}
                    alt={img.altText || product?.title || "USA Gummies"}
                    fill
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/60">
                    No image
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-xl font-black text-white">
                  {product?.title || "USA Gummies"}
                </h3>
                <p className="text-sm text-white/70 line-clamp-6">
                  {description || "See the product page for full ingredients and nutrition details."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={href} className="btn btn-red">
                    View full details
                  </Link>
                  <Link
                    href={`${href}?focus=bundles`}
                    className="btn btn-outline"
                  >
                    Jump to bundles
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
