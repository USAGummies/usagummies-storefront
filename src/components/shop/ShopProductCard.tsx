import Link from "next/link";
import Image from "next/image";
import { money } from "@/lib/storefront";
import QuickBuy from "@/components/shop/QuickBuy.client";

type ProductCardData = any;

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
  if (price?.amount && price?.currencyCode) return money(price.amount, price.currencyCode);

  if (
    product?.priceRange?.minVariantPrice?.amount &&
    product?.priceRange?.minVariantPrice?.currencyCode
  ) {
    return money(
      product.priceRange.minVariantPrice.amount,
      product.priceRange.minVariantPrice.currencyCode
    );
  }

  return "";
}

export function ShopProductCard({
  product,
  addToCartAction,
  campaign,
  hasBundle,
}: {
  product: ProductCardData;
  addToCartAction?: (fd: FormData) => Promise<void>;
  campaign?: string | null;
  hasBundle?: boolean;
}) {
  const img = product?.featuredImage;
  const priceText = formatPrice(product);

  const basePath = `/products/${product.handle}`;

  const href = campaign
    ? `${basePath}?campaign=${encodeURIComponent(campaign)}`
    : basePath;

  const bundleHref = campaign
    ? `${basePath}?focus=bundles&campaign=${encodeURIComponent(campaign)}`
    : `${basePath}?focus=bundles`;

  return (
    <div className="group flex h-full w-full max-w-[340px] flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-[14px] shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl glass-card">
      <Link href={href} className="block">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_14px_28px_rgba(0,0,0,0.18)]">
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

          {hasBundle ? (
            <div className="absolute left-2 top-2 rounded-full border border-[rgba(205,53,50,0.35)] bg-[rgba(205,53,50,0.12)] px-3 py-1 text-[11px] font-bold text-[var(--red)]">
              Bundle deals inside
            </div>
          ) : null}

          <div className="absolute bottom-2 right-2 rounded-full border border-white/15 bg-[rgba(12,20,38,0.72)] px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
            Free ship 5+
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

          <div className="text-sm text-[var(--muted)]">
            {priceText ? (
              <>
                Starting at <span className="font-semibold text-[var(--text)]">{priceText}</span>
              </>
            ) : (
              <span>See pricing</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {["🇺🇸 Made in USA", "🌿 All Natural", "✅ Dye-Free"].map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
        </div>
      </Link>

      <div className="mt-3 grid gap-2">
        <Link href={bundleHref} className="btn btn-navy justify-center min-h-[44px]">
          View product
        </Link>

        {addToCartAction ? (
          <QuickBuy product={product} addToCartAction={addToCartAction} campaign={campaign || null} />
        ) : null}
      </div>
    </div>
  );
}
