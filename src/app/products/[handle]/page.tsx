// /products/[handle] — single-product PDP. Uses the LP design language
// (HeroSection, ScarcityBar, ThreePromises, GuaranteeBlock, FaqAccordion)
// with PDP-specific extras: ProductGallery (multi-angle bag photos for
// SEO image search), ReviewsSection (full review wall), ProductFaqAccordion
// (product-specific FAQ), BagSlider as the second purchase opportunity at
// the bottom. ProductJsonLd + BreadcrumbJsonLd preserved for rich results.
//
// Net: 298-line bespoke PDP → ~140-line LP-flow PDP with all SEO +
// commerce wiring intact.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HeroSection } from "@/components/lp/HeroSection";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";
import { StickyBuyBar } from "@/components/lp/StickyBuyBar";

import Image from "next/image";
import BagSlider from "@/components/purchase/BagSlider.client";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import FocusBundles from "./FocusBundles.client";
import ReviewsSection from "@/components/home/ReviewsSection";
import ProductFaqAccordion from "./ProductFaqAccordion";
import ProductViewTracker from "@/components/tracking/ProductViewTracker.client";

import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { buildCanonicalUrl, resolveSiteUrl } from "@/lib/seo/canonical";
import { getProductByHandle } from "@/lib/storefront";
import { getReviewAggregate } from "@/lib/reviews/aggregate";

export const revalidate = 3600;

const OG_IMAGE = "/opengraph-image";
const PRODUCT_TITLE_FALLBACK = "Dye-Free Gummies Made in USA";
const PRODUCT_DESCRIPTION_FALLBACK =
  "Shop USA Gummies made in USA candy with no artificial dyes. Dye-free gummies for patriotic parties and gifts.";
const PRODUCT_TITLE_SUFFIX = " | Dye-Free Gummies Made in USA";
const PRODUCT_TITLE_MAX = 70;
const PRODUCT_DESCRIPTION_PREFIX = "Shop ";
const PRODUCT_DESCRIPTION_SUFFIX =
  ", a made in USA candy with no artificial dyes. Dye-free gummies for patriotic parties and gifts.";
const PRODUCT_DESCRIPTION_MAX = 155;

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trimEnd();
}

function buildProductTitle(name?: string | null) {
  if (!name) return PRODUCT_TITLE_FALLBACK;
  const maxName = PRODUCT_TITLE_MAX - PRODUCT_TITLE_SUFFIX.length;
  const safeName = clampText(name, Math.max(0, maxName));
  return `${safeName}${PRODUCT_TITLE_SUFFIX}`;
}

function buildProductDescription(name?: string | null) {
  if (!name) return PRODUCT_DESCRIPTION_FALLBACK;
  const maxName =
    PRODUCT_DESCRIPTION_MAX -
    PRODUCT_DESCRIPTION_PREFIX.length -
    PRODUCT_DESCRIPTION_SUFFIX.length;
  const safeName = clampText(name, Math.max(0, maxName));
  return `${PRODUCT_DESCRIPTION_PREFIX}${safeName}${PRODUCT_DESCRIPTION_SUFFIX}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

type MetadataProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<SearchParams>;
};

type PageProps = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: MetadataProps): Promise<Metadata> {
  const { handle } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const siteUrl = resolveSiteUrl();
  const canonical = buildCanonicalUrl({
    pathname: `/products/${handle}`,
    searchParams: resolvedSearchParams,
    siteUrl,
  });

  let productTitle: string | null = null;
  let productDescription: string | null = null;
  let imageUrl: string | null = null;

  try {
    const detail = await getProductByHandle(handle);
    productTitle = detail?.product?.title ?? null;
    productDescription = detail?.product?.description ?? null;
    imageUrl = detail?.product?.featuredImage?.url ?? null;
  } catch {
    productTitle = null;
    productDescription = null;
    imageUrl = null;
  }

  const title = buildProductTitle(productTitle);
  const description = productDescription || buildProductDescription(productTitle);
  const ogImage = imageUrl || OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [{ url: ogImage }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { handle } = await params;
  const detail = await getProductByHandle(handle);
  const product = detail?.product;

  if (!product) {
    notFound();
  }

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const reviewAggregate = await getReviewAggregate();

  const productImages = (product.images?.edges || [])
    .map((edge: any) => edge?.node)
    .filter(Boolean);
  const productImageUrls = productImages.map((img: any) => img?.url).filter(Boolean);
  const stickyImage =
    product.featuredImage?.url ||
    productImageUrls[0] ||
    "/brand/usa-gummies-family.webp";
  const fallbackPrice =
    bundleVariants?.variants?.find((variant) => variant.quantity === 1)?.totalPrice ?? null;
  const priceAmount =
    product.priceRange?.minVariantPrice?.amount ||
    (fallbackPrice !== null ? fallbackPrice.toFixed(2) : BASE_PRICE.toFixed(2));
  const priceCurrency = product.priceRange?.minVariantPrice?.currencyCode || "USD";
  const productSku =
    product.variants?.edges
      ?.map((edge: any) => edge?.node)
      .find((variant: any) => variant?.sku)?.sku ||
    bundleVariants?.singleBagSku ||
    SINGLE_BAG_SKU;

  return (
    <main>
      <ProductViewTracker
        productId={product.handle}
        productName={product.title}
        price={Number(priceAmount) || 5.99}
        currency={priceCurrency}
      />
      <FocusBundles targetSelector="#product-bundles" />

      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
          { name: product.title, href: `/products/${product.handle}` },
        ]}
      />

      <HeroSection />
      <ScarcityBar />

      {/* Product gallery — multi-angle photography for SEO image
       * search and shoppers who want to see more before buying. */}
      <section className="bg-[var(--lp-cream)] border-b-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Every Angle ★</p>
            <h2 className="lp-display text-[clamp(1.8rem,4vw,2.6rem)] text-[var(--lp-ink)]">
              See it from
              <br />
              <span className="lp-script text-[var(--lp-red)]">every side.</span>
            </h2>
          </div>
          <ProductGallery
            title={product.title}
            featured={product.featuredImage ?? null}
            images={productImages}
          />
        </div>
      </section>

      <ThreePromises />

      {/* "In your hands" lifestyle shot — bridges from the abstract
       * promises section into the social-proof reviews wall. Real
       * hands tearing open the bag conveys "this is the actual bag
       * you'll get". Round-2 ad asset. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <figure
              className="relative overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
              <div className="relative aspect-square w-full">
                <Image
                  src="/brand/ad-assets-round2/photo-the-reveal.png"
                  alt="Hands tearing open a bag of USA Gummies on a rustic wooden table"
                  fill
                  sizes="(max-width: 1024px) 88vw, 600px"
                  className="object-cover"
                />
              </div>
            </figure>

            <div>
              <p className="lp-label mb-3 text-[var(--lp-red)]">★ In Your Hands ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] leading-[1] text-[var(--lp-ink)]">
                A bag built
                <br />
                <span className="lp-script text-[var(--lp-red)]">to be opened.</span>
              </h2>
              <p className="lp-sans mt-5 text-[1.1rem] leading-[1.6] text-[var(--lp-ink)]/85">
                7.5 oz of dye-free gummy bears in a single tear-top bag.
                Made in the U.S.A. and sized to share — though we
                won&rsquo;t tell anyone if you don&rsquo;t.
              </p>
            </div>
          </div>
        </div>
      </section>

      <GuaranteeBlock />

      {/* Reviews — full review wall with verified-buyer rating. */}
      <section
        id="product-reviews"
        className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]"
      >
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Verified Buyers ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
              What folks are
              <br />
              <span className="lp-script text-[var(--lp-red)]">saying.</span>
            </h2>
          </div>
          <ReviewsSection />
        </div>
      </section>

      {/* Product-specific FAQ — distinct from the brand FAQ above. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-6 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Product FAQ ★</p>
            <h2 className="lp-display text-[clamp(1.8rem,4vw,2.6rem)] text-[var(--lp-ink)]">
              About this
              <br />
              <span className="lp-script text-[var(--lp-red)]">bag.</span>
            </h2>
          </div>
          <ProductFaqAccordion />
        </div>
      </section>

      <FaqAccordion />

      {/* Second purchase opportunity at the bottom — bundle savings
       * panel for shoppers who scrolled all the way through. */}
      <section
        id="product-bundles"
        className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]"
      >
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Bundle &amp; Save ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
              Lower the
              <br />
              <span className="lp-script text-[var(--lp-red)]">per-bag price.</span>
            </h2>
            <p className="lp-sans mx-auto mt-3 max-w-[42ch] text-[var(--lp-ink)]/85">
              Add bags, watch the price drop. {FREE_SHIPPING_PHRASE}.{" "}
              <Link href="/ingredients" className="underline underline-offset-4">
                Ingredients &amp; allergen info
              </Link>
              .
            </p>
          </div>
          <div
            className="mx-auto max-w-[600px] border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 shadow-[6px_6px_0_var(--lp-red)] sm:p-7"
          >
            <BagSlider variant="full" defaultQty={5} />
          </div>
        </div>
      </section>

      <StickyBuyBar />
      <BagSlider variant="sticky" defaultQty={5} />

      <ProductJsonLd
        name={product.title}
        description={product.description || PRODUCT_DESCRIPTION_FALLBACK}
        handle={product.handle}
        imageUrls={productImageUrls.length ? productImageUrls : [stickyImage]}
        sku={productSku}
        currencyCode={priceCurrency}
        priceAmount={priceAmount}
        brandName="USA Gummies"
        siteUrl={resolveSiteUrl()}
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
