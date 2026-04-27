// Homepage — LP-language skeleton. Same brand voice + components as
// `/lp/dye-free-gummies`, with the live commerce wiring intact (the LP
// `HeroSection` already renders `<BagSlider variant="full" defaultQty={5} />`
// which drives real Shopify cart adds via the Storefront API).
//
// Section flow:
//   HeroSection         — H1, product photo, BagSlider buy widget
//   ScarcityBar         — verified bag claims on starfield strip
//   ThreePromises       — three pillars + flavor lineup
//   BombsAway           — "taste of freedom" type-led panel
//   RealMomentsStrip    — UGC-style stripe (lifestyle moments)
//   FoundersLetter      — story column + script accent
//   SustainabilityBlock — Made-in-USA values panel
//   GuaranteeBlock      — 30-day satisfaction stamp
//   FaqAccordion        — FAQ
//   LatestFromBlog      — recent posts (existing component)
//
// SEO: keep ProductJsonLd + BreadcrumbJsonLd at the bottom — feeds Google
// rich results with price, availability, aggregate rating.
import type { Metadata } from "next";
import Link from "next/link";

import { HeroSection } from "@/components/lp/HeroSection";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { BombsAway } from "@/components/lp/BombsAway";
import { RealMomentsStrip } from "@/components/lp/RealMomentsStrip";
import { FoundersLetter } from "@/components/lp/FoundersLetter";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";
import { StickyBuyBar } from "@/components/lp/StickyBuyBar";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";

import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Made in USA Candy & Dye-Free Gummies | USA Gummies";
const PAGE_DESCRIPTION =
  "Real gummy bears, sourced, made, and packed in the U.S.A. Five natural flavors. No artificial dyes. 30-day satisfaction guarantee.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: SITE_URL,
    type: "website",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default async function HomePage() {
  // SEO data — fetch product details + review aggregate for ProductJsonLd.
  // Failures fall back gracefully so the page still renders if Shopify is
  // unreachable.
  let productsPage: Awaited<ReturnType<typeof getProductsPage>> | null = null;
  try {
    productsPage = await getProductsPage({ pageSize: 1, sort: "best-selling" });
  } catch {
    productsPage = null;
  }

  const product = (productsPage?.nodes?.[0] as any) ?? null;
  const handle =
    product?.handle?.toString?.() ||
    "all-american-gummy-bears-7-5-oz-single-bag";

  let detailedProduct: any = null;
  try {
    const detail = await getProductByHandle(handle);
    detailedProduct = detail?.product || null;
  } catch {
    detailedProduct = null;
  }

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const productImages =
    (detailedProduct?.images?.edges || []).map((e: any) => e?.node) || [];
  const heroImage =
    productImages[0]?.url || `${SITE_URL}/brand/usa-gummies-family.webp`;
  const productImageUrls = productImages
    .map((img: any) => img?.url)
    .filter(Boolean);

  const fallbackPrice =
    bundleVariants?.variants?.find((variant) => variant.quantity === 1)?.totalPrice ?? null;
  const priceAmount =
    detailedProduct?.priceRange?.minVariantPrice?.amount ||
    (fallbackPrice !== null ? fallbackPrice.toFixed(2) : BASE_PRICE.toFixed(2));
  const priceCurrency =
    detailedProduct?.priceRange?.minVariantPrice?.currencyCode || "USD";
  const productSku =
    detailedProduct?.variants?.edges
      ?.map((edge: any) => edge?.node)
      .find((variant: any) => variant?.sku)?.sku ||
    bundleVariants?.singleBagSku ||
    SINGLE_BAG_SKU;
  const reviewAggregate = await getReviewAggregate();

  return (
    <main>
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }]} />

      <HeroSection review={reviewAggregate} />
      <ScarcityBar />
      <ThreePromises />
      <BombsAway />
      <RealMomentsStrip />
      <FoundersLetter />
      <SustainabilityBlock />
      <GuaranteeBlock />
      <FaqAccordion />

      {/* Latest from the blog — kept on the homepage as a content hub
       * signal for SEO. Wrapped in a cream section so it inherits the
       * LP-language background. */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ From the Journal ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
              Latest stories.
            </h2>
          </div>
          <LatestFromBlog />
          <div className="mt-8 text-center">
            <Link
              href="/blog"
              className="lp-cta inline-flex items-center justify-center"
            >
              Read all stories
            </Link>
          </div>
        </div>
      </section>

      <StickyBuyBar />

      <ProductJsonLd
        name={detailedProduct?.title || PAGE_TITLE}
        description={detailedProduct?.description || PAGE_DESCRIPTION}
        handle={handle}
        imageUrls={productImageUrls.length ? productImageUrls : [heroImage]}
        sku={productSku}
        currencyCode={priceCurrency}
        priceAmount={priceAmount}
        brandName="USA Gummies"
        siteUrl={SITE_URL}
        availability={
          bundleVariants?.availableForSale === false ? "OutOfStock" : "InStock"
        }
        aggregateRating={
          reviewAggregate
            ? {
                ratingValue: reviewAggregate.ratingValue,
                reviewCount: reviewAggregate.reviewCount,
              }
            : null
        }
      />
    </main>
  );
}
