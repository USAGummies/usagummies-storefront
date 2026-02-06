// src/app/shop/page.tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { DETAIL_BULLETS } from "@/data/productDetails";
import styles from "../homepage-scenes.module.css";

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

  const productHandle =
    detailedProduct?.handle || primaryProduct?.handle || "all-american-gummy-bears-7-5-oz-single-bag";
  const heroBundleQuantities = [1, 2, 3, 4, 5, 8, 12];
  const homepageTiers = (bundleVariants?.variants || []).filter((t: any) =>
    heroBundleQuantities.includes(t.quantity)
  );

  const stickyImage =
    detailedProduct?.featuredImage?.url || primaryProduct?.featuredImage?.url || "/brand/usa-gummies-family.webp";
  const stickyAlt = detailedProduct?.featuredImage?.altText || "USA Gummies bag";

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detailedProduct?.title || "USA Gummies - All American Gummy Bears",
    description:
      "All-American gummy bears made in the USA with all natural flavors and no artificial dyes.",
    image: detailedProduct?.featuredImage?.url ? [detailedProduct.featuredImage.url] : undefined,
    brand: {
      "@type": "Brand",
      name: "USA Gummies",
    },
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/shop`,
      priceCurrency: detailedProduct?.priceRange?.minVariantPrice?.currencyCode || "USD",
      ...(detailedProduct?.priceRange?.minVariantPrice?.amount
        ? { price: detailedProduct.priceRange.minVariantPrice.amount }
        : {}),
      availability:
        bundleVariants?.availableForSale === false
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
    },
  };

  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
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
                        alt=""
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
                      Ingredients &amp; allergen info: <Link href="/ingredients">ingredients</Link>.
                    </div>
                  </div>
                  <div className="atomic-buy__media">
                    <div className="atomic-buy__mediaFrame">
                      <div className="relative aspect-[4/5] w-full">
                        <Image
                          src="/Hero-pack.jpeg"
                          alt="USA Gummies bag"
                          fill
                          sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 420px"
                          className="object-contain drop-shadow-[0_24px_50px_rgba(13,28,51,0.2)]"
                        />
                      </div>
                      <span className="usa-stamp usa-stamp--small atomic-buy__stamp">
                        Made in USA
                      </span>
                    </div>
                  </div>
                  <div className="atomic-buy__bundle">
                    <BundleQuickBuy
                      anchorId="shop-bundles"
                      productHandle={productHandle}
                      tiers={homepageTiers}
                      singleBagVariantId={bundleVariants?.singleBagVariantId}
                      availableForSale={bundleVariants?.availableForSale}
                      variant="compact"
                      tone="light"
                      surface="flat"
                      layout="classic"
                      showHowItWorks={false}
                      summaryCopy="5+ bags ship free from us. Under 5 bags, we send you to Amazon to save you on shipping."
                      showTrainAccent={false}
                      showAccent={false}
                      showEducation={false}
                      ctaVariant="simple"
                      primaryCtaLabel="Unlock Best Value + Free Shipping"
                      featuredQuantities={[5, 8, 12]}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">Bag count guides:</span>
                <Link href="/gummy-gift-bundles" className="underline underline-offset-4">
                  Gift bag options
                </Link>
                <Link href="/patriotic-party-snacks" className="underline underline-offset-4">
                  Party snacks
                </Link>
                <Link href="/bulk-gummy-bears" className="underline underline-offset-4">
                  Bulk gummy bears
                </Link>
              </div>
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
    </main>
  );
}
