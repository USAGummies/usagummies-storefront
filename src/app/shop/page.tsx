// /shop — single-product brand storefront. Uses the same LP-language
// skeleton as the homepage (HeroSection, ScarcityBar, etc.) plus
// shop-specific extras: internal-link modules (related products + top
// guides), bag-count guide links, and ProductJsonLd for rich-result
// eligibility.
//
// Net: 413-line bespoke shop page → ~140-line LP-flow shop page with
// all SEO machinery + commerce wiring intact.
import type { Metadata } from "next";
import Link from "next/link";

import { HeroSection } from "@/components/lp/HeroSection";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";
import { StickyBuyBar } from "@/components/lp/StickyBuyBar";
import { ReviewHighlights } from "@/components/reviews/ReviewHighlights";
import ProductViewTracker from "@/components/tracking/ProductViewTracker.client";

import { GuideCard } from "@/components/internal-links/GuideCard";
import { LinkModule } from "@/components/internal-links/LinkModule";
import { RelatedProductCard } from "@/components/internal-links/RelatedProductCard";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";

import { getProductsPage } from "@/lib/shopify/products";
import { getProductsForInternalLinks } from "@/lib/shopify/internalLinks";
import { getProductByHandle } from "@/lib/storefront";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { buildCanonicalUrl } from "@/lib/seo/canonical";
import {
  MIN_RELATED_SCORE,
  buildProductSignals,
  buildSignalsFromValues,
  rankRelated,
} from "@/lib/internalLinks";
import { getTopGuideCandidates } from "@/lib/guides";

const PAGE_SIZE = 1;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
const OG_IMAGE = "/opengraph-image";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const title = "Shop Dye-Free Gummies & Made in USA Candy";
  const description =
    "Browse all USA Gummies products: made in USA candy with no artificial dyes, patriotic favorites, and bundle savings.";
  const canonical = buildCanonicalUrl({
    pathname: "/shop",
    searchParams: resolvedSearchParams,
    siteUrl: SITE_URL,
  });

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [{ url: OG_IMAGE }] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}

export default async function ShopPage() {
  let results: Awaited<ReturnType<typeof getProductsPage>>;
  try {
    results = await getProductsPage({ pageSize: PAGE_SIZE, sort: "best-selling" });
  } catch {
    results = {
      nodes: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    } as any;
  }

  const primaryProduct = results.nodes?.[0] ?? null;
  let detailedProduct: any = null;
  try {
    if (primaryProduct?.handle) {
      const detail = await getProductByHandle(primaryProduct.handle);
      detailedProduct = detail?.product || null;
    }
  } catch {
    detailedProduct = null;
  }

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  let internalProducts: Awaited<ReturnType<typeof getProductsForInternalLinks>> = [];
  try {
    internalProducts = await getProductsForInternalLinks();
  } catch {
    internalProducts = [];
  }

  const reviewAggregate = await getReviewAggregate();
  const guideCandidates = getTopGuideCandidates();
  const productHandle =
    detailedProduct?.handle ||
    primaryProduct?.handle ||
    "all-american-gummy-bears-7-5-oz-single-bag";

  // Rank related products + guides for the bottom internal-link
  // modules. Relevance signals come from product type / tags /
  // collections / SEO metafields.
  const sourceSignals = buildProductSignals({
    handle: productHandle,
    productType: detailedProduct?.productType,
    tags: detailedProduct?.tags,
    collections: detailedProduct?.collections?.nodes,
    seoKeywords: detailedProduct?.seoKeywords?.value,
    seoCategory: detailedProduct?.seoCategory?.value,
    createdAt: detailedProduct?.createdAt || primaryProduct?.createdAt,
  });

  const relatedProducts = (() => {
    if (!internalProducts.length) return [];
    const candidates = internalProducts.map((product) => ({
      item: product,
      signals: buildProductSignals({
        handle: product.handle,
        productType: product.productType,
        tags: product.tags,
        collections: product.collections?.nodes,
        seoKeywords: product.seoKeywords?.value,
        seoCategory: product.seoCategory?.value,
        createdAt: product.createdAt,
      }),
    }));
    return rankRelated(sourceSignals, candidates, {
      limit: 4,
      includeProductType: true,
      minScore: MIN_RELATED_SCORE,
      minCount: 4,
    });
  })();

  const topGuides = (() => {
    if (!guideCandidates.length) return [];
    const candidates = guideCandidates.map((guide) => ({
      item: guide,
      signals: buildSignalsFromValues({
        url: guide.href,
        category: guide.topic,
        tags: guide.tags,
        keywords: guide.keywords,
        date: guide.updated || guide.date,
      }),
    }));
    return rankRelated(sourceSignals, candidates, {
      limit: 3,
      minScore: MIN_RELATED_SCORE,
      minCount: 3,
    });
  })();

  const hasModules = relatedProducts.length || topGuides.length;

  // SEO data for ProductJsonLd
  const stickyImage =
    detailedProduct?.featuredImage?.url ||
    primaryProduct?.featuredImage?.url ||
    "/brand/usa-gummies-family.webp";
  const productImages =
    (detailedProduct?.images?.edges || []).map((edge: any) => edge?.node) || [];
  const productImageUrls = productImages.map((img: any) => img?.url).filter(Boolean);
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

  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
        ]}
      />

      {/* Fire Meta ViewContent on /shop page load (2026-04-28). Until
       * this was added, the pixel only fired ViewContent on
       * /products/[handle] which our cold-ad traffic never visits — they
       * all land on /shop. Without ViewContent signal, Meta couldn't
       * optimize Sales-objective ad sets and view_content stuck at 1
       * despite 240+ landing_page_views from the ads. */}
      <ProductViewTracker
        productId={SINGLE_BAG_SKU}
        productName="All American Gummy Bears - 7.5 oz Bag"
        price={BASE_PRICE}
        currency="USD"
      />

      <HeroSection />
      <ScarcityBar />
      <ThreePromises />
      <GuaranteeBlock />

      {/* Real customer testimonials — wired 2026-04-26 to address cold-ad
       * trust gap. Component (ReviewHighlights) and data (REVIEW_HIGHLIGHTS,
       * 3 verified 5-star reviews) already existed; they were just not
       * mounted on the shop page. Cold Meta traffic needs explicit social
       * proof to convert. Positioned after GuaranteeBlock so the trust
       * stack reads: Three Promises → Guarantee → Verified Reviews. */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-6 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Verified Reviews ★</p>
            <h2 className="lp-display text-[clamp(1.8rem,4vw,2.6rem)] text-[var(--lp-ink)]">
              What customers say.
            </h2>
          </div>
          <div className="mx-auto max-w-2xl">
            <ReviewHighlights variant="light" limit={3} />
          </div>
        </div>
      </section>

      {/* Internal-link hub — SEO-valuable cross-links to bag-count guides
       * and related products. Wrapped in an LP-language section so it
       * matches the brand. */}
      {hasModules ? (
        <section className="border-y-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)]">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
            <div className="mb-8 text-center">
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Explore the Lineup ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
                More from
                <br />
                <span className="lp-script text-[var(--lp-red)]">USA Gummies.</span>
              </h2>
            </div>
            <div className="link-modules">
              {relatedProducts.length ? (
                <LinkModule title="Related Products">
                  {relatedProducts.map((product) => (
                    <RelatedProductCard key={product.id} product={product} />
                  ))}
                </LinkModule>
              ) : null}
              {topGuides.length ? (
                <LinkModule title="Top Guides">
                  {topGuides.map((guide) => (
                    <GuideCard key={guide.href} guide={guide} />
                  ))}
                </LinkModule>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Bag-count guides — direct text links for SEO + navigation. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14 text-center">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ How Many Bags? ★</p>
          <h2 className="lp-display text-[clamp(1.8rem,4vw,2.6rem)] text-[var(--lp-ink)]">
            Pick the right bag count.
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {[
              { href: "/gummy-gift-bundles", label: "Gift bag options" },
              { href: "/patriotic-party-snacks", label: "Party snacks" },
              { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
              { href: "/no-artificial-dyes-gummy-bears", label: "Red 40 free" },
              { href: "/made-in-usa-candy", label: "American-made candy" },
            ].map((g) => (
              <Link
                key={g.href}
                href={g.href}
                className="lp-label inline-flex items-center gap-2 border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-4 py-2 text-[var(--lp-ink)] shadow-[3px_3px_0_var(--lp-red)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--lp-red)] transition-transform"
              >
                <span aria-hidden className="lp-star-ornament h-3 w-3 text-[var(--lp-red)]" />
                {g.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FaqAccordion />

      {/* Latest from blog — content hub signal. */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ From the Journal ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
              Latest stories.
            </h2>
          </div>
          <LatestFromBlog />
        </div>
      </section>

      <StickyBuyBar />

      <ProductJsonLd
        name={detailedProduct?.title || "USA Gummies - All American Gummy Bears"}
        description={
          detailedProduct?.description ||
          "All-American gummy bears made in the USA with all natural flavors and no artificial dyes."
        }
        handle={productHandle}
        imageUrls={productImageUrls.length ? productImageUrls : [stickyImage]}
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
