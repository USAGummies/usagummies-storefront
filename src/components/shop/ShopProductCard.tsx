// src/components/shop/ShopProductCard.tsx (FULL REPLACE)
import Link from "next/link";
import Image from "next/image";
import { money } from "@/lib/storefront";
import QuickBuy from "@/components/shop/QuickBuy.client";

type ProductCardData = any;

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/75">
      {children}
    </span>
  );
}

export function ShopProductCard({
  product,
  addToCartAction,
  campaign,
}: {
  product: ProductCardData;
  addToCartAction?: (fd: FormData) => Promise<void>;
  campaign?: string | null;
}) {
  const img = product?.featuredImage;
  const variants =
    product?.variants?.nodes ||
    product?.variants?.edges?.map((e: any) => e.node) ||
    [];
  const v0 = variants?.[0];

  const price =
    v0?.price ||
    product?.priceRange?.minVariantPrice ||
    product?.priceRange?.minVariantPrice?.amount;

  const priceText =
    typeof price === "string"
      ? price
      : price?.amount && price?.currencyCode
      ? money(price.amount, price.currencyCode)
      : product?.priceRange?.minVariantPrice?.amount &&
        product?.priceRange?.minVariantPrice?.currencyCode
      ? money(
          product.priceRange.minVariantPrice.amount,
          product.priceRange.minVariantPrice.currencyCode
        )
      : "";

  const href = campaign
    ? `/products/${product.handle}?campaign=${encodeURIComponent(campaign)}`
    : `/products/${product.handle}`;

  const bundleHref = campaign
    ? `/products/${product.handle}?focus=bundles&campaign=${encodeURIComponent(
        campaign
      )}`
    : `/products/${product.handle}?focus=bundles`;

  return (
    <div
      className={[
        // Base card
        "glass-soft group relative overflow-hidden rounded-3xl border border-white/10 p-3",
        "transition-all duration-300",
        "will-change-transform",
        // Premium hover (RELIABLE: ring + shadow + lift)
        "hover:-translate-y-1 hover:scale-[1.01]",
        "hover:border-[#d4af37]/50 hover:ring-1 hover:ring-[#d4af37]/35",
        "hover:shadow-2xl",
      ].join(" ")}
    >
      {/* Gold halo overlay (visual pop, but subtle + premium) */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute -inset-24 rounded-[48px] bg-[radial-gradient(closest-side,rgba(212,175,55,0.18),rgba(212,175,55,0.0))]" />
      </div>

      <Link href={href} className="block">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          {img?.url ? (
            <Image
              src={img.url}
              alt={img.altText || product.title}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.08]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
              No image
            </div>
          )}

          {/* small top-left tag */}
          <div className="absolute left-2 top-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/80 backdrop-blur">
            <span className="font-semibold">Bundle deals inside</span>
          </div>

          {/* bottom-right shipping tag */}
          <div className="absolute bottom-2 right-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/80 backdrop-blur">
            Free ship 5+
          </div>
        </div>

        <div className="mt-3">
          <div className="text-sm font-semibold text-white">{product.title}</div>

          <div className="mt-1 text-sm text-white/70">
            {priceText ? (
              <>
                {priceText} <span className="text-white/35">•</span>{" "}
                <span className="text-white/75">Free shipping on 5+ bags</span>
              </>
            ) : (
              <span className="text-white/60">See pricing</span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Pill>All natural</Pill>
            <Pill>No artificial dyes</Pill>
            <Pill>Made in USA</Pill>
          </div>
        </div>
      </Link>

      <div className="mt-3 grid gap-2">
        <Link
          href={bundleHref}
          className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          See bundle pricing →
        </Link>

        {addToCartAction ? (
          <QuickBuy
            product={product}
            addToCartAction={addToCartAction}
            campaign={campaign || null}
          />
        ) : null}

        <div className="text-xs text-white/55">Most customers choose 8 bags+.</div>
      </div>
    </div>
  );
}
