"use client";

import Link from "next/link";
import Image from "next/image";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import QuickView from "@/components/shop/QuickView.client";

type ProductCardData = any;

function formatMoney(amount: string | number, currency = "USD") {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `${amount}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatPrice(product: ProductCardData) {
  const variants =
    product?.variants?.nodes ||
    product?.variants?.edges?.map((e: any) => e.node) ||
    [];
  const v0 = variants?.[0];

  const price =
    v0?.price ||
    product?.priceRange?.minVariantPrice ||
    product?.priceRange?.minVariantPrice?.amount;

  if (typeof price === "string") return price;
  if (price?.amount && price?.currencyCode) return formatMoney(price.amount, price.currencyCode);

  if (
    product?.priceRange?.minVariantPrice?.amount &&
    product?.priceRange?.minVariantPrice?.currencyCode
  ) {
    return formatMoney(
      product.priceRange.minVariantPrice.amount,
      product.priceRange.minVariantPrice.currencyCode
    );
  }

  return "";
}

export function ShopProductCard({
  product,
  campaign,
  hasBundle,
}: {
  product: ProductCardData;
  campaign?: string | null;
  hasBundle?: boolean;
}) {
  const img = product?.featuredImage;
  const priceText = formatPrice(product);

  const basePath = "/shop";
  const detailHref = campaign
    ? `${basePath}?campaign=${encodeURIComponent(campaign)}#product-details`
    : `${basePath}#product-details`;

  const bundleHref = campaign
    ? `${basePath}?campaign=${encodeURIComponent(campaign)}#product-bundles`
    : `${basePath}#product-bundles`;

  return (
    <QuickView product={product} detailHref={detailHref} bundleHref={bundleHref}>
      {(open) => (
        <div
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
          className="group flex h-full w-full max-w-[340px] flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_40px_rgba(15,27,45,0.12)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(15,27,45,0.16)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
        >
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2),0_12px_24px_rgba(15,27,45,0.12)]">
            {img?.url ? (
              <Image
                src={img.url}
                alt={img.altText || product.title}
                fill
                sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
                No image
              </div>
            )}

            <div className="absolute inset-0 flex items-end justify-center p-3 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
                className="rounded-full border border-[var(--border)] bg-white/90 px-4 py-2 text-xs font-semibold text-[var(--navy)] shadow-[0_10px_24px_rgba(15,27,45,0.18)] backdrop-blur-md"
              >
                Quick view
              </button>
            </div>

            {hasBundle ? (
              <div className="absolute left-2 top-2 rounded-full border border-[rgba(199,54,44,0.35)] bg-[rgba(199,54,44,0.12)] px-3 py-1 text-[11px] font-bold text-[var(--red)]">
                Savings inside
              </div>
            ) : null}

            <div className="absolute bottom-2 right-2 rounded-full border border-[var(--border)] bg-white/90 px-3 py-1 text-[11px] font-semibold text-[var(--navy)] backdrop-blur-md">
              {FREE_SHIPPING_PHRASE}
            </div>
          </div>

          <div className="mt-3 space-y-1">
            <div
              className="text-base font-black leading-tight text-[var(--text)]"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {product.title}
            </div>

            <div className="flex items-center justify-between gap-2 text-sm text-[var(--muted)]">
              {priceText ? (
                <>
                  Starting at <span className="font-semibold text-[var(--text)]">{priceText}</span>
                </>
              ) : (
                <span>See pricing</span>
              )}
              <span className="text-xs font-semibold text-[var(--navy)] underline underline-offset-4">
                Quick view
              </span>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {["🇺🇸 Made in USA", "🌿 All Natural", "✅ Dye-Free"].map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            <Link
              href={bundleHref}
              className="btn btn-candy justify-center min-h-[44px]"
              onClick={(e) => e.stopPropagation()}
            >
              Lock in savings now
            </Link>
            <AmazonOneBagNote className="text-[11px] text-[var(--muted)]" />
          </div>
        </div>
      )}
    </QuickView>
  );
}
