// src/app/shop/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import PurchaseBox from "@/app/products/[handle]/PurchaseBox.client";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle, money } from "@/lib/storefront";
import { pricingForQty, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

const PAGE_SIZE = 1;
function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const LISTING_TITLE =
  "USA Gummies – All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors";
const DETAIL_BULLETS = [
  "Made in the USA and packed in FDA-compliant facilities.",
  "Colored naturally with fruit + vegetable extracts. No artificial dyes.",
  "Soft, chewy classic gummy bear flavor.",
  "7.5 oz bag with five fruit flavors: Cherry, Watermelon, Orange, Green Apple, Lemon.",
];
const HERO_BULLETS = [
  "Made in the USA. Produced and packed in FDA-compliant facilities.",
  "No artificial dyes. Colored naturally with fruit + vegetable extracts.",
  "5 fruit flavors: Cherry, Watermelon, Orange, Green Apple, Lemon.",
];

export async function generateMetadata(): Promise<Metadata> {
  const title = "Shop USA Gummies | Bundle & Save on American-Made Gummies";
  const description =
    "Explore USA Gummies bundles and best sellers. Made in the USA, all natural, dye-free. Free shipping on 5+ bags.";
  const canonical = `${SITE_URL}/shop`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
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

  const currency =
    detailedProduct?.priceRange?.minVariantPrice?.currencyCode ||
    primaryProduct?.priceRange?.minVariantPrice?.currencyCode ||
    "USD";

  const bestValuePerBagText = money(pricingForQty(8).perBag.toFixed(2), currency);
  const productTitle = LISTING_TITLE;
  const productFeatured = detailedProduct?.featuredImage || primaryProduct?.featuredImage || null;
  const productImages = (detailedProduct?.images?.edges || []).map((e: any) => e.node);
  const productVariants = (detailedProduct?.variants?.edges || []).map((e: any) => e.node);
  const purchaseProduct = detailedProduct
    ? {
        title: detailedProduct.title,
        handle: detailedProduct.handle,
        description: detailedProduct.description,
        variants: { nodes: productVariants },
        priceRange: detailedProduct.priceRange,
      }
    : null;

  const stickyImage =
    productFeatured?.url || productImages?.[0]?.url || "/home-patriotic-product.jpg";
  const stickyAlt = productFeatured?.altText || "USA Gummies bag";
  const lowBundlePrice = pricingForQty(1).total;
  const highBundlePrice = pricingForQty(12).total;

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
    offers: {
      "@type": "AggregateOffer",
      url: `${SITE_URL}/shop`,
      priceCurrency: currency,
      lowPrice: Number.isFinite(lowBundlePrice) ? lowBundlePrice.toFixed(2) : undefined,
      highPrice: Number.isFinite(highBundlePrice) ? highBundlePrice.toFixed(2) : undefined,
      offerCount: 4,
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
      <section className="relative overflow-hidden bg-[#fffdf8]">

        <div className="relative mx-auto max-w-6xl px-4 py-10 lg:py-12">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)] sm:text-xs">
                <span className="rounded-full border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1 text-[var(--navy)]">Made in the USA</span>
                <span className="text-[var(--candy-red)]">No artificial dyes</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-[var(--navy)] sm:text-5xl">
                  All-American Gummy Bears
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Made in the USA. Colored naturally. Classic flavor done right.
                </p>
              </div>

              <div className="grid gap-2 text-sm text-[var(--muted)]">
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
                Most customers save more when they build a bundle.
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <a href="#bundle-pricing" className="btn btn-candy">
                  Build my bundle
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

              <div className="candy-panel rounded-3xl p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Bundle savings</div>
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

            <div className="relative space-y-4">
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

              <div className="relative aspect-[3/2] overflow-hidden">
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

      <section id="bundle-pricing" aria-label="Bundle pricing" className="bg-[#fffdf8] scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 pb-8 lg:pb-10">
          <div className="rounded-3xl border border-[rgba(15,27,45,0.12)] bg-white p-3 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
            {purchaseProduct ? (
              <PurchaseBox product={purchaseProduct as any} />
            ) : (
              <div className="p-4 text-sm text-[var(--muted)]">
                Product details are loading. Please refresh to view bundle pricing.
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="product-details" aria-label="Product details" className="bg-[#fffdf8] scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
          <div className="candy-panel rounded-[36px] p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Product details
                </div>
                <h2 className="text-2xl font-black text-[var(--text)] sm:text-3xl">
                  {productTitle}
                </h2>
                <div className="grid gap-2 text-sm text-[var(--muted)]">
                  {DETAIL_BULLETS.map((bullet) => (
                    <div key={bullet} className="flex items-start gap-2">
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
                <div className="text-sm text-[var(--muted)]">
                  Every bag supports American manufacturing and American jobs.
                </div>
                <div className="text-sm text-[var(--muted)]">
                  Unlike imported gummies, USA Gummies are made and packed entirely in America.
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Ingredients &amp; allergen info: see the ingredient panel on the bag or{" "}
                  <Link href="/ingredients" className="underline underline-offset-4 text-[var(--text)]">
                    ingredients
                  </Link>
                  .
                </div>
              </div>

              <div className="space-y-4">
                <ProductGallery
                  title={productTitle}
                  featured={productFeatured}
                  images={productImages}
                />
              </div>
            </div>

            <AmericanDreamCallout variant="compact" tone="light" className="mt-6" showJoinButton={false} />
          </div>
        </div>
      </section>

      <StickyAddToCartBar
        title="USA Gummies bundle"
        priceText={`${bestValuePerBagText} / bag`}
        imageUrl={stickyImage}
        imageAlt={stickyAlt}
        purchaseSelector="#bundle-pricing"
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
