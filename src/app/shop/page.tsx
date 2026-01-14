// src/app/shop/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Link from "next/link";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import PurchaseBox from "@/app/products/[handle]/PurchaseBox.client";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle, money } from "@/lib/storefront";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { pricingForQty, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

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
const LISTING_BULLETS = [
  {
    title: "MADE IN THE USA",
    body:
      "Proudly sourced, manufactured, and packed entirely in America. Supporting local jobs while delivering a better-quality gummy you can trust.",
  },
  {
    title: "NO ARTIFICIAL DYES OR SYNTHETIC COLORS",
    body:
      "Colored naturally using real fruit and vegetable extracts. No fake brightness, no artificial dyes.",
  },
  {
    title: "CLASSIC GUMMY BEAR FLAVOR — DONE RIGHT",
    body:
      "All the chewy, fruity flavor you expect from a gummy bear, just without artificial ingredients or harsh aftertaste.",
  },
  {
    title: "PERFECT FOR EVERYDAY SNACKING",
    body:
      "Great for lunchboxes, desk drawers, road trips, care packages, and guilt-free sweet cravings.",
  },
  {
    title: "7.5 OZ BAG WITH 5 FRUIT FLAVORS",
    body:
      "Cherry, Watermelon, Orange, Green Apple, and Lemon. Clearly labeled, honestly made, and easy to share.",
  },
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
  const primaryHandle = primaryProduct?.handle || "all-american-gummy-bears-7-5-oz-single-bag";
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

  const featuredQuantities = [1, 4, 5, 8, 12];
  const bestValuePerBagText = money(pricingForQty(8).perBag.toFixed(2), currency);

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const quickBuyTiers = bundleVariants?.variants || [];

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

  return (
    <main className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen home-metal pb-16">
      <section
        className="relative overflow-hidden bg-[var(--navy)] text-white hero-parallax"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 45%, rgba(255,255,255,0) 100%), radial-gradient(circle at 12% 18%, rgba(199,54,44,0.22), rgba(255,255,255,0) 38%), radial-gradient(circle at 85% 0%, rgba(255,255,255,0.08), rgba(255,255,255,0) 30%)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.06), transparent 40%)",
            opacity: 0.4,
          }}
        />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[rgba(199,54,44,0.28)] blur-3xl" aria-hidden="true" />
        <div className="absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4 py-10 lg:py-12">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70 sm:text-xs">
                <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1">Made in the USA</span>
                <span className="text-[var(--gold)]">No artificial dyes</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
                  Shop USA Gummies
                </h1>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  {LISTING_TITLE}.
                </p>
              </div>

              <div className="grid gap-2 text-sm text-white/75">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                  <span>
                    {LISTING_BULLETS[0].title} – {LISTING_BULLETS[0].body}
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-[rgba(199,54,44,0.8)]" />
                  <span>
                    {LISTING_BULLETS[1].title} – {LISTING_BULLETS[1].body}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-white/70">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-white/50" />
                  <span>
                    {LISTING_BULLETS[2].title} – {LISTING_BULLETS[2].body}
                  </span>
                </div>
              </div>

              <div className="text-xs text-white/65">{LISTING_BULLETS[4].body}</div>

              <div className="flex flex-wrap items-center gap-3">
                <a href="#bundle-pricing" className="btn btn-red">
                  Build my bundle
                </a>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                >
                  Buy 1-3 bags on Amazon
                </a>
                <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
              </div>

              <div className="metal-panel rounded-3xl border border-white/12 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Best value</div>
                    <div className="text-base font-black text-white">8 bags</div>
                    <div className="text-[11px] text-white/70">~ {bestValuePerBagText} / bag</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-white/10 sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Free shipping</div>
                    <div className="text-base font-black text-white">5+ bags</div>
                    <div className="text-[11px] text-white/70">{FREE_SHIPPING_PHRASE}</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-white/10 sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">No artificial dyes</div>
                    <div className="text-base font-black text-white">All natural flavors</div>
                    <div className="text-[11px] text-white/70">Colored with fruit + vegetable extracts</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.45)] p-3 ring-1 ring-white/20 shadow-[0_32px_90px_rgba(7,12,20,0.6)]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  <span>Build your bundle</span>
                  <span className="text-[var(--gold)]">{featuredQuantities.join(" / ")} bags</span>
                </div>
                <div className="mt-1 text-xs text-white/70">
                  Tap a bundle size to lock your price.
                </div>
                <div className="mt-3 space-y-3">
                  <div
                    id="bundle-pricing"
                    data-purchase-section="true"
                    className="bundle-home metal-panel rounded-[28px] border border-[rgba(199,160,98,0.4)] p-2 shadow-[0_22px_60px_rgba(7,12,20,0.6)]"
                  >
                    <BundleQuickBuy
                      anchorId="bundle-pricing"
                      productHandle={primaryHandle}
                      tiers={quickBuyTiers}
                      singleBagVariantId={bundleVariants?.singleBagVariantId}
                      availableForSale={bundleVariants?.availableForSale}
                      featuredQuantities={featuredQuantities}
                      variant="compact"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product-details" aria-label="Product details" className="bg-[var(--navy)] scroll-mt-24">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
          <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.25)] p-5 sm:p-6">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                Product details
              </div>
              <h2 className="text-2xl font-black text-white sm:text-3xl">
                {productTitle}
              </h2>
              <div className="grid gap-2 text-sm text-white/75">
                {LISTING_BULLETS.map((bullet, idx) => (
                  <div
                    key={bullet.title}
                    className={["flex items-start gap-2", idx > 2 ? "text-white/65" : ""].join(" ")}
                  >
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                    <span>
                      {bullet.title} – {bullet.body}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-white/70">
                Ingredients &amp; allergen info: see the ingredient panel on the bag or{" "}
                <Link href="/ingredients" className="underline underline-offset-4 hover:text-white">
                  ingredients
                </Link>
                .
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href="#product-bundles" className="btn btn-red">
                  Build my bundle
                </a>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                >
                  Buy 1-3 bags on Amazon
                </a>
              </div>
              <div className="text-xs text-white/70">
                {FREE_SHIPPING_PHRASE} • Ships within 24 hours • 30-day money-back guarantee
              </div>

              <AmericanDreamCallout variant="compact" className="mt-4" />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div className="space-y-4">
                <ProductGallery
                  title={productTitle}
                  featured={productFeatured}
                  images={productImages}
                />
                <div className="rounded-3xl border border-white/15 bg-white/5 p-4 text-white/75">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    Bundle pricing
                  </div>
                  <div className="mt-2 text-sm">
                    Bundle pricing lowers the per-bag cost as you add bags. {FREE_SHIPPING_PHRASE}.
                  </div>
                </div>
              </div>

              <div
                id="product-bundles"
                className="scroll-mt-24 rounded-3xl border border-[rgba(199,160,98,0.35)] metal-panel p-3 shadow-[0_26px_70px_rgba(7,12,20,0.45)]"
              >
                {purchaseProduct ? (
                  <PurchaseBox product={purchaseProduct as any} />
                ) : (
                  <div className="p-4 text-sm text-[var(--muted)]">
                    Product details are loading. Please refresh to view bundle pricing.
                  </div>
                )}
              </div>
            </div>
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
    </main>
  );
}
