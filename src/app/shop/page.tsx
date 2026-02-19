// src/app/shop/page.tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import BagSlider from "@/components/purchase/BagSlider.client";
import { GuideCard } from "@/components/internal-links/GuideCard";
import { LinkModule } from "@/components/internal-links/LinkModule";
import { RelatedProductCard } from "@/components/internal-links/RelatedProductCard";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductsForInternalLinks } from "@/lib/shopify/internalLinks";
import { getProductByHandle } from "@/lib/storefront";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { DETAIL_BULLETS } from "@/data/productDetails";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { buildCanonicalUrl } from "@/lib/seo/canonical";
import {
  MIN_RELATED_SCORE,
  buildProductSignals,
  buildSignalsFromValues,
  rankRelated,
} from "@/lib/internalLinks";
import { getTopGuideCandidates } from "@/lib/guides";
import styles from "../homepage-scenes.module.css";

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
    openGraph: {
      title,
      description,
      url: canonical,
      images: [{ url: OG_IMAGE }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

export default async function ShopPage() {
  let results: Awaited<ReturnType<typeof getProductsPage>>;
  try {
    results = await getProductsPage({
      pageSize: PAGE_SIZE,
      sort: "best-selling",
    });
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

  const guideCandidates = getTopGuideCandidates();
  const productHandle =
    detailedProduct?.handle || primaryProduct?.handle || "all-american-gummy-bears-7-5-oz-single-bag";

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

  const stickyImage =
    detailedProduct?.featuredImage?.url || primaryProduct?.featuredImage?.url || "/brand/usa-gummies-family.webp";
  const productImages =
    (detailedProduct?.images?.edges || []).map((edge: any) => edge?.node) || [];
  const productImageUrls = productImages.map((img: any) => img?.url).filter(Boolean);
  const fallbackPrice =
    bundleVariants?.variants?.find((variant) => variant.quantity === 1)?.totalPrice ?? null;
  const priceAmount =
    detailedProduct?.priceRange?.minVariantPrice?.amount ||
    (fallbackPrice !== null ? fallbackPrice.toFixed(2) : BASE_PRICE.toFixed(2));
  const priceCurrency = detailedProduct?.priceRange?.minVariantPrice?.currencyCode || "USD";
  const productSku =
    detailedProduct?.variants?.edges
      ?.map((edge: any) => edge?.node)
      .find((variant: any) => variant?.sku)?.sku ||
    bundleVariants?.singleBagSku ||
    SINGLE_BAG_SKU;

  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen pb-16">
      <div className="relative w-full h-[280px] sm:h-[340px] lg:h-[380px] overflow-hidden">
        <Image
          src="/brand/americana/founding-fathers-fireside.jpg"
          alt="Founding fathers in a warm fireside setting with USA Gummies"
          fill
          sizes="100vw"
          className="object-cover object-top"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/55 to-[#1B2A4A]/75" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <div className="relative w-52 h-24 mb-3">
            <Image src="/brand/logo-full.png" alt="USA Gummies" fill sizes="208px" className="object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            Shop USA Gummies
          </h1>
          <p className="mt-2 text-sm text-white/90 max-w-md drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
            Classic gummy bears, made in the USA. No artificial dyes.
          </p>
        </div>
      </div>

      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
        ]}
      />

      <section className={`${styles.scene} ${styles.sceneBundle} home-purchase-stage`} data-zone="BUNDLE">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 pb-1 sm:pb-1.5 lg:pb-2">
            <div className="mt-0">
              <div id="hero-primary-cta" className="atomic-buy americana-panel">
                <div className="atomic-buy__glow" aria-hidden="true" />
                <div className="atomic-buy__header">
                  <div className="atomic-buy__headerMain">
                    <div className="atomic-buy__kicker flex items-center gap-2">
                      <Image
                        src="/brand/logo.png"
                        alt="USA Gummies logo"
                        aria-hidden="true"
                        width={72}
                        height={24}
                        className="brand-logo-mark"
                      />
                      <span>USA Gummies</span>
                    </div>
                    <div className="atomic-buy__headerTitle">
                      Classic gummy bears, made in the USA.
                    </div>
                  </div>
                  <div className="atomic-buy__headerSub">
                    Add more bags and watch your per-bag price drop. Savings apply to your total bag count.
                  </div>
                </div>
                <div className="atomic-buy__grid">
                  <div className="atomic-buy__details">
                    <ul className="atomic-buy__bullets">
                      {DETAIL_BULLETS.slice(0, 3).map((bullet) => (
                        <li key={bullet} className="atomic-buy__bullet">
                          <span className="atomic-buy__bulletDot" aria-hidden="true" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="atomic-buy__chips">
                      <span className="atomic-buy__chip">Made in USA</span>
                      <span className="atomic-buy__chip">No artificial dyes</span>
                      <span className="atomic-buy__chip">All natural</span>
                      <span className="atomic-buy__chip">{FREE_SHIPPING_PHRASE}</span>
                    </div>
                    <div className="atomic-buy__ingredients">
                      Ingredients &amp; allergen info: <Link href="/ingredients">ingredients</Link>. Guide:{" "}
                      <Link href="/no-artificial-dyes-gummy-bears">No Artificial Dyes Gummy Bears</Link>.
                    </div>
                  </div>
                  <div className="atomic-buy__media">
                    <div className="atomic-buy__mediaFrame">
                      <div className="relative aspect-[4/5] w-full">
                        <Image
                          src="/Hero-pack.jpeg"
                          alt="Bag of USA Gummies classic gummy bears"
                          fill
                          priority
                          fetchPriority="high"
                          sizes="(max-width: 640px) 90vw, (max-width: 1023px) 92vw, 560px"
                          className="object-contain drop-shadow-[0_24px_50px_rgba(13,28,51,0.2)]"
                        />
                      </div>
                      <span className="usa-stamp usa-stamp--small atomic-buy__stamp">
                        Made in USA
                      </span>
                    </div>
                  </div>
                  <div className="atomic-buy__bundle">
                    <BagSlider variant="full" defaultQty={5} />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[#1B2A4A]/70">
                <span className="font-semibold text-[#1B2A4A]">Bag count guides:</span>
                <Link href="/gummy-gift-bundles" className="underline underline-offset-4">
                  Gift bag options
                </Link>
                <Link href="/patriotic-party-snacks" className="underline underline-offset-4">
                  Party snacks
                </Link>
                <Link href="/bulk-gummy-bears" className="underline underline-offset-4">
                  Bulk gummy bears
                </Link>
                <Link href="/no-artificial-dyes-gummy-bears" className="underline underline-offset-4">
                  Red 40 Free Gummies
                </Link>
              </div>
              <div className="mt-2 text-[11px] text-[#1B2A4A]/80">
                Learn about{" "}
                <Link href="/made-in-usa-candy" className="underline underline-offset-4">
                  American-Made Candy
                </Link>
                .
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="BLOG">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <LatestFromBlog />
        </div>
      </section>

      {hasModules ? (
        <section className="bg-transparent" data-zone="INTERNAL-LINKS">
          <div className="mx-auto max-w-6xl px-4 py-4">
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

      <BagSlider variant="sticky" defaultQty={5} />

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
        availability={bundleVariants?.availableForSale === false ? "OutOfStock" : "InStock"}
      />
    </main>
  );
}
