// src/app/shop/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import { pricingForQty, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";
import { BRAND_STORY_HEADLINE, BRAND_STORY_MEDIUM } from "@/data/brandStory";
import { DETAIL_BULLETS } from "@/data/productDetails";

const PAGE_SIZE = 1;
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
const LISTING_TITLE =
  "USA Gummies – All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors";
const HERO_BULLETS = [
  "Made in the USA. Produced and packed in FDA-compliant facilities.",
  "No artificial dyes. Colored naturally with fruit + vegetable extracts.",
  "5 fruit flavors: Cherry, Watermelon, Orange, Green Apple, Lemon.",
];

export async function generateMetadata(): Promise<Metadata> {
  const title = "Shop USA Gummies | Buy More, Save More on American-Made Gummies";
  const description =
    "Explore USA Gummies savings and best sellers. Made in the USA, all natural, dye-free. Free shipping on 5+ bags.";
  const canonical = `${SITE_URL}/shop`;

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

  const currency =
    detailedProduct?.priceRange?.minVariantPrice?.currencyCode ||
    primaryProduct?.priceRange?.minVariantPrice?.currencyCode ||
    "USD";

  const productTitle = LISTING_TITLE;
  const productFeatured = detailedProduct?.featuredImage || primaryProduct?.featuredImage || null;
  const productImages = (detailedProduct?.images?.edges || []).map((e: any) => e.node);
  const productHandle =
    detailedProduct?.handle || primaryProduct?.handle || "all-american-gummy-bears-7-5-oz-single-bag";

  const stickyImage =
    productFeatured?.url || productImages?.[0]?.url || "/brand/usa-gummies-family.webp";
  const stickyAlt = productFeatured?.altText || "USA Gummies bag";
  const lowBundlePrice = pricingForQty(1).total;
  const featuredBundlePrice = pricingForQty(8).total;
  const reviewItems = REVIEW_HIGHLIGHTS.map((review) => ({
    "@type": "Review",
    name: "USA Gummies review",
    reviewBody: review.body,
    author: {
      "@type": "Person",
      name: review.author,
    },
    reviewRating: {
      "@type": "Rating",
      ratingValue: review.rating,
      bestRating: 5,
      worstRating: 1,
    },
  }));
  const avgRating =
    REVIEW_HIGHLIGHTS.length > 0
      ? REVIEW_HIGHLIGHTS.reduce((sum, review) => sum + review.rating, 0) /
        REVIEW_HIGHLIGHTS.length
      : null;
  const reviewAggregate = await getReviewAggregate();
  const aggregateRatingValue = reviewAggregate?.ratingValue ?? (avgRating ? Number(avgRating.toFixed(1)) : null);
  const aggregateReviewCount = reviewAggregate?.reviewCount ?? REVIEW_HIGHLIGHTS.length;

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: LISTING_TITLE,
    description:
      "All-American gummy bears made in the USA with all natural flavors and no artificial dyes.",
    image: productFeatured?.url ? [productFeatured.url] : undefined,
    brand: {
      "@type": "Brand",
      name: "USA Gummies",
    },
    review: reviewItems.length ? reviewItems : undefined,
    aggregateRating: aggregateRatingValue
      ? {
          "@type": "AggregateRating",
          ratingValue: aggregateRatingValue,
          reviewCount: aggregateReviewCount,
        }
      : undefined,
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/shop`,
      priceCurrency: currency,
      ...(Number.isFinite(featuredBundlePrice)
        ? { price: featuredBundlePrice.toFixed(2) }
        : Number.isFinite(lowBundlePrice)
          ? { price: lowBundlePrice.toFixed(2) }
          : {}),
      availability: "https://schema.org/InStock",
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "US",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: 0,
            maxValue: 1,
            unitCode: "d",
          },
        },
      },
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Where are USA Gummies made?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "USA Gummies are sourced, made, and packed in the USA.",
        },
      },
      {
        "@type": "Question",
        name: "Do your gummy bears contain artificial dyes?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. USA Gummies are colored naturally with fruit and vegetable extracts.",
        },
      },
      {
        "@type": "Question",
        name: "How fast do orders ship?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Orders are packed and shipped within 24 hours, with tracking provided once your label is created.",
        },
      },
      {
        "@type": "Question",
        name: "What allergens should I know about?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Please review the ingredient panel on the bag for the most current allergen details. Contact us if you have sensitivities before ordering.",
        },
      },
    ],
  };

  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
        ]}
      />
      <section className="relative overflow-hidden bg-[#fffdf8]">

        <div className="relative mx-auto max-w-6xl px-4 py-6 lg:py-8">
          <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)] sm:text-xs">
                <span className="rounded-full border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1 text-[var(--navy)]">Made in the USA</span>
                <span className="text-[var(--candy-red)]">No artificial dyes</span>
              </div>

              <div className="space-y-1">
                <h1 className="text-balance text-4xl font-black leading-[1.05] tracking-tight text-[var(--navy)] sm:text-5xl">
                  All-American Gummy Bears
                </h1>
                <p className="text-pretty text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Made in the USA. Colored naturally. Classic flavor done right.
                </p>
              </div>

              <div className="grid gap-1 text-sm text-[var(--muted)]">
                {HERO_BULLETS.map((line, idx) => (
                  <div key={line} className="flex items-start gap-2">
                    <span
                      className={[
                        "mt-1.5 h-2 w-2 rounded-full",
                        idx === 0
                          ? "bg-[var(--candy-red)]"
                          : idx === 1
                            ? "bg-[var(--candy-orange)]"
                            : "bg-[var(--candy-green)]",
                      ].join(" ")}
                    />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              <div className="text-xs text-[var(--muted)]">
                Most customers save more when they add more bags.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a href="#shop-bundles" className="btn btn-candy">
                  Lock in savings now
                </a>
                <span className="text-xs text-[var(--muted)]">
                  Love it or your money back - Ships within 24 hours - Limited daily production
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <Link href="/ingredients" className="underline underline-offset-4 text-[var(--text)]">
                  Ingredients
                </Link>
                <span className="text-[var(--muted)]">|</span>
                <Link href="/policies/shipping" className="underline underline-offset-4 text-[var(--text)]">
                  Shipping
                </Link>
                <span className="text-[var(--muted)]">|</span>
                <Link href="/faq" className="underline underline-offset-4 text-[var(--text)]">
                  FAQ
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">Bag count guides:</span>
                <Link href="/gummy-gift-bundles" className="underline underline-offset-4 text-[var(--text)]">
                  Gift bag options
                </Link>
                <span className="text-[var(--muted)]">|</span>
                <Link href="/patriotic-party-snacks" className="underline underline-offset-4 text-[var(--text)]">
                  Party snacks
                </Link>
                <span className="text-[var(--muted)]">|</span>
                <Link href="/bulk-gummy-bears" className="underline underline-offset-4 text-[var(--text)]">
                  Bulk gummy bears
                </Link>
              </div>

              <div className="candy-panel rounded-3xl p-2.5">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Savings tiers</div>
                    <div className="text-base font-black text-[var(--text)]">4+ bags</div>
                    <div className="text-[11px] text-[var(--muted)]">Lower price per bag as you add more.</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-[rgba(15,27,45,0.12)] sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Free shipping</div>
                    <div className="text-base font-black text-[var(--text)]">5+ bags</div>
                    <div className="text-[11px] text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-[rgba(15,27,45,0.12)] sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Five fruit flavors</div>
                    <div className="text-base font-black text-[var(--text)]">Classic gummy mix</div>
                    <div className="text-[11px] text-[var(--muted)]">Cherry, lemon, orange, green apple, watermelon.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative space-y-3">
              <div className="candy-panel relative overflow-hidden rounded-3xl p-2 text-[var(--text)]">
                <div className="relative aspect-[3/2] overflow-hidden rounded-2xl border border-white/60 bg-white">
                  <Image
                    src="/america-250.jpg"
                    alt="USA Gummies patriotic artwork"
                    fill
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 44vw, 520px"
                    className="object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/80">
                      Made in USA
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    All American
                  </div>
                  <div className="text-sm font-semibold text-[var(--text)]">
                    Proudly made in the USA.
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    All natural flavors. No artificial dyes.
                  </div>
                </div>
              </div>

              <div className="relative aspect-[3/2] lg:aspect-[5/2] overflow-hidden">
                <Image
                  src="/website%20assets/IwaJima.png"
                  alt="Iwo Jima memorial illustration"
                  fill
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 44vw, 520px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="shop-bundles" aria-label="Savings pricing" className="bg-[#fffdf8] scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 pb-5 lg:pb-6">
          <div className="bundle-home bundle-home--premium bundle-hero-stage buy-module americana-panel relative rounded-[36px] border border-[rgba(15,27,45,0.12)] bg-white shadow-[0_30px_80px_rgba(15,27,45,0.14)]">
            <div className="buy-module__inner">
            <div className="buy-module__layout">
              <div
                id="product-details"
                className="buy-module__details min-w-0 scroll-mt-24"
              >
                  <h2 className="text-balance text-2xl font-black text-[var(--text)] sm:text-3xl">
                    {productTitle}
                  </h2>
                  <div className="grid gap-1.5 text-sm text-[var(--muted)]">
                    {DETAIL_BULLETS.map((bullet) => (
                      <div key={bullet} className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pill-row-tight flex flex-wrap gap-2">
                    <span className="candy-pill">Made in USA</span>
                    <span className="candy-pill">No artificial dyes</span>
                    <span className="candy-pill">{FREE_SHIPPING_PHRASE}</span>
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    Every bag supports American manufacturing and American jobs.
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    Unlike imported gummies, USA Gummies are made and packed entirely in America.
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Ingredients &amp; allergen info: see the ingredient panel on the bag or{" "}
                    <Link
                      href="/ingredients"
                      className="underline underline-offset-4 text-[var(--text)]"
                    >
                      ingredients
                    </Link>
                    .
                  </div>
                </div>

                <div className="buy-module__rail min-w-0">
                  <div className="buy-module__image">
                    <div className="buy-module__imagePanel">
                      <div className="relative">
                        <ProductGallery
                          title={productTitle}
                          featured={productFeatured}
                          images={productImages}
                        />
                        <span className="usa-stamp usa-stamp--small absolute left-4 top-4">Made in USA</span>
                      </div>
                    </div>
                  </div>
                  <div className="buy-module__bundle">
                    {bundleVariants ? (
                      <BundleQuickBuy
                        anchorId="shop-bundles"
                        productHandle={productHandle}
                        tiers={bundleVariants.variants}
                        singleBagVariantId={bundleVariants.singleBagVariantId}
                        availableForSale={bundleVariants.availableForSale}
                        variant="compact"
                        tone="light"
                        surface="flat"
                        layout="classic"
                        showHowItWorks={false}
                        summaryCopy=""
                        showTrainAccent={false}
                        showAccent={false}
                        showEducation={false}
                        ctaVariant="simple"
                        primaryCtaLabel="Add to Cart"
                      />
                    ) : (
                      <div className="p-4 text-sm text-[var(--muted)]">
                        Product details are loading. Please refresh to view savings pricing.
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
          <div className="mt-2">
            <AmericanDreamCallout
              variant="compact"
              tone="light"
              showJoinButton={false}
            />
          </div>
        </div>
      </section>

      <div className="americana-divider" aria-hidden="true" />

      <section aria-label="Bag count guides" className="bg-[#fffdf8]">
        <div className="mx-auto max-w-6xl px-4 pb-5 lg:pb-6">
          <div className="candy-panel americana-panel rounded-[32px] p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Image
                    src="/brand/logo.png"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={20}
                    className="brand-logo-mark"
                  />
                  <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                    Bag count guides
                  </div>
                </div>
                <h2 className="text-balance text-2xl font-black text-[var(--text)]">
                  Need help picking a bag count?
                </h2>
                <p className="text-pretty text-sm text-[var(--muted)] max-w-prose">
                  Match the right bag count for gifts, parties, and bulk orders.
                </p>
              </div>
              <Link href="/bundle-guides" className="btn btn-outline">
                View all guides
              </Link>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                {
                  href: "/gummy-gift-bundles",
                  title: "Gift bag options",
                  copy: "Build thoughtful gifts for birthdays and care packages.",
                },
                {
                  href: "/patriotic-party-snacks",
                  title: "Party snacks",
                  copy: "Plan July 4th tables and patriotic celebrations.",
                },
                {
                  href: "/bulk-gummy-bears",
                  title: "Bulk gummy bears",
                  copy: "Order for teams, events, and corporate gifting.",
                },
              ].map((guide) => (
                <Link
                  key={guide.href}
                  href={guide.href}
                  className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3 text-sm text-[var(--text)] transition hover:border-[rgba(15,27,45,0.22)] hover:shadow-[0_14px_28px_rgba(15,27,45,0.12)]"
                >
                  <div className="text-sm font-semibold">{guide.title}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">{guide.copy}</div>
                  <div className="mt-3 text-xs font-semibold text-[var(--navy)]">
                    Read guide {"->"}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Our story" className="bg-[#fffdf8]">
        <div className="mx-auto max-w-6xl px-4 pb-5 lg:pb-6">
          <div className="candy-panel rounded-[32px] p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <Image
                src="/brand/logo.png"
                alt=""
                aria-hidden="true"
                width={64}
                height={20}
                className="brand-logo-mark"
              />
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Our story
              </div>
            </div>
            <h2 className="text-balance mt-1.5 text-2xl font-black text-[var(--text)]">
              {BRAND_STORY_HEADLINE}
            </h2>
            <div className="mt-2 copy-stack copy-stack--rail text-sm text-[var(--muted)] text-pretty">
              {BRAND_STORY_MEDIUM.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href="/about" className="btn btn-outline">
                Read our story
              </Link>
              <Link href="/shop#shop-bundles" className="btn btn-candy">
                Lock in savings now
              </Link>
            </div>
          </div>
        </div>
      </section>

      <StickyAddToCartBar
        title="In your cart"
        imageUrl={stickyImage}
        imageAlt={stickyAlt}
        buttonLabel="Buy now"
        source="shop"
        className="sm:hidden"
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
