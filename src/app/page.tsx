import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { BundleQuickBuyCtaProof, BundleQuickBuyRailProof } from "@/components/home/BundleQuickBuyProof";
import ReviewsSection from "@/components/home/ReviewsSection";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { BRAND_STORY_HEADLINE, BRAND_STORY_PARAGRAPHS } from "@/data/brandStory";
import { DETAIL_BULLETS } from "@/data/productDetails";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { LazyStickyAddToCartBar } from "@/components/product/LazyStickyAddToCartBar.client";
import LazyHeroCTAWatcher from "@/components/home/LazyHeroCTAWatcher.client";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";
import styles from "./homepage-scenes.module.css";

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
const PAGE_TITLE =
  "Made in USA Candy & Dye-Free Gummies | USA Gummies";
const PAGE_DESCRIPTION =
  "Classic gummy bears made in the USA with zero artificial dyes. Free shipping on 5+ bags. Rated 4.8 stars by verified buyers. Shop bundles and save.";
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

const SOCIAL_LINKS = [
  {
    name: "Instagram",
    href: "https://www.instagram.com/usagummies/",
    label: "@usagummies",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="5"
          ry="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Facebook",
    href: "https://www.facebook.com/people/USA-Gummies/61581802793282/",
    label: "USA Gummies",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          fill="currentColor"
          d="M13.5 8.5h3V6h-3c-2.5 0-4.5 2-4.5 4.5V13H7v3h2v5h3v-5h3l1-3h-4v-2.5c0-0.6 0.4-1 1-1z"
        />
      </svg>
    ),
  },
  {
    name: "TikTok",
    href: "https://www.tiktok.com/@usa.gummies?lang=en",
    label: "@usa.gummies",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          fill="currentColor"
          d="M15.5 4c.4 1.6 1.7 3 3.5 3.4v3c-1.5 0-2.9-.5-4-1.3v6.1c0 3.1-2.6 5.8-5.8 5.8S3.5 19 3.5 15.9c0-3.1 2.5-5.5 5.6-5.5.5 0 1 .1 1.5.2v3.3c-.5-.2-1-.4-1.6-.4-1.3 0-2.4 1.1-2.4 2.4 0 1.4 1.1 2.5 2.5 2.5 1.4 0 2.4-1.1 2.4-2.5V4h4z"
        />
      </svg>
    ),
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@USAGummies",
    label: "USA Gummies",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect
          x="3"
          y="6"
          width="18"
          height="12"
          rx="3"
          ry="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <polygon points="10,9 16,12 10,15" fill="currentColor" />
      </svg>
    ),
  },
];

export default async function HomePage() {
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

  const productImages =
    (detailedProduct?.images?.edges || []).map((e: any) => e?.node) || [];
  const whyImage = productImages[1] || productImages[0] || null;
  const whyImageSrc = whyImage?.url || "/brand/usa-gummies-family.webp";
  const whyImageAlt = whyImage?.altText || "USA Gummies in hand";

  const heroMediaSrc = "/Hero-new.jpeg";
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const heroBundleQuantities = [1, 2, 3, 4, 5, 8, 12];
  const homepageTiers = (bundleVariants?.variants || []).filter((t) =>
    heroBundleQuantities.includes(t.quantity)
  );

  const heroImage = productImages[0]?.url || `${SITE_URL}/brand/usa-gummies-family.webp`;
  const heroImageAlt = productImages[0]?.altText || "Bag of USA Gummies classic gummy bears";
  const fallbackPrice =
    bundleVariants?.variants?.find((variant) => variant.quantity === 1)?.totalPrice ?? null;
  const priceAmount =
    detailedProduct?.priceRange?.minVariantPrice?.amount ||
    (fallbackPrice !== null ? fallbackPrice.toFixed(2) : BASE_PRICE.toFixed(2));
  const priceCurrency =
    detailedProduct?.priceRange?.minVariantPrice?.currencyCode || "USD";
  const reviewAggregate = await getReviewAggregate();
  const productImageUrls = productImages.map((img: any) => img?.url).filter(Boolean);
  const productSku =
    detailedProduct?.variants?.edges
      ?.map((edge: any) => edge?.node)
      .find((variant: any) => variant?.sku)?.sku ||
    bundleVariants?.singleBagSku ||
    SINGLE_BAG_SKU;

  const whyCards = [
    {
      title: "Made in the USA",
      copy: "Proudly sourced, manufactured, and packed entirely in America.",
      icon: (
        <span className="text-lg" aria-hidden="true">
          🇺🇸
        </span>
      ),
    },
    {
      title: "No artificial dyes",
      copy: "Colored naturally using real fruit and vegetable extracts.",
      icon: (
        <span className="text-lg" aria-hidden="true">
          🌿
        </span>
      ),
    },
    {
      title: "Classic gummy bear flavor",
      copy: "Chewy, fruity flavor without artificial ingredients or harsh aftertaste.",
      icon: (
        <span className="text-lg" aria-hidden="true">
          🍬
        </span>
      ),
    },
  ];

  return (
    <main className="relative overflow-hidden min-h-screen pb-12 lg:pb-0 home-candy text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
        ]}
      />
      <section className={`${styles.scene} ${styles.sceneBundle} home-purchase-stage home-hero-theme`} data-zone="BUNDLE">
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
                      Ingredients &amp; allergen info:{" "}
                      <Link href="/ingredients">ingredients</Link>.
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
                    <BundleQuickBuy
                      anchorId="bundle-pricing"
                      productHandle={handle}
                      tiers={homepageTiers}
                      singleBagVariantId={bundleVariants?.singleBagVariantId}
                      availableForSale={bundleVariants?.availableForSale}
                      variant="compact"
                      tone="light"
                      surface="flat"
                      layout="classic"
                      railProofSlot={<BundleQuickBuyRailProof tone="light" />}
                      ctaProofSlot={
                        <BundleQuickBuyCtaProof tone="light" surface="flat" layout="classic" variant="compact" />
                      }
                      showHowItWorks={false}
                      summaryCopy="5+ bags ship free from us. Under 5 bags, we send you to Amazon to save you on shipping."
                      showTrainAccent={false}
                      showAccent={false}
                      showEducation={false}
                      ctaVariant="simple"
                      primaryCtaLabel="Shop & save"
                      selectorVariant="cards"
                      featuredQuantities={[5, 8, 12]}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-white/70">
                <span className="font-semibold text-white">Guides:</span>
                <Link href="/gummy-gift-bundles" className="underline underline-offset-4">
                  Gift bags
                </Link>
                <Link href="/patriotic-party-snacks" className="underline underline-offset-4">
                  Party snacks
                </Link>
                <Link href="/bulk-gummy-bears" className="underline underline-offset-4">
                  Bulk orders
                </Link>
                <Link href="/gummy-calculator" className="underline underline-offset-4">
                  Bag calculator
                </Link>
                <Link href="/dye-free-vs-regular-gummies" className="underline underline-offset-4">
                  Dye-free vs regular
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-product-stage home-hero-theme" data-zone="HERO">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 lg:py-12">
          <div className="relative grid gap-6 lg:gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="order-2 relative lg:order-1">
              <div className="relative z-10 space-y-3 sm:space-y-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/brand/logo.png"
                    alt="USA Gummies logo"
                    width={110}
                    height={36}
                    className="h-8 w-auto sm:h-9"
                  />
                  <div className="h-5 w-px bg-white/25" aria-hidden="true" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/60">
                    Proudly American
                  </span>
                </div>
                <h1 className="text-balance text-[36px] font-black leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  All-American<br className="hidden sm:block" /> Gummy Bears
                </h1>
                <p className="text-pretty text-base text-white/80 sm:text-lg max-w-md">
                  Classic gummy bears, made in the USA with no artificial dyes and all natural flavors.
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, i) => (
                      <svg key={i} className="h-4 w-4 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-[var(--gold)]">
                    4.8 stars from verified Amazon buyers
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Link href="#bundle-pricing" className="btn btn-candy text-base px-6 py-3.5">
                    Shop &amp; save
                  </Link>
                  <a href="#bundle-pricing" className="hero-scroll-link text-sm text-white/80" data-hero-scroll>
                    See bundle pricing
                  </a>
                </div>
                <div className="pt-2 space-y-2">
                  <div className="text-sm font-medium text-white/60">
                    {FREE_SHIPPING_PHRASE} • Satisfaction guaranteed
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      Made in USA
                    </span>
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      Ships in 24 hours
                    </span>
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      Secure checkout
                    </span>
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      FDA-registered facility
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
              <div className="home-hero__media relative w-full max-w-[280px] sm:max-w-[380px] lg:max-w-[460px]">
                <div className="relative aspect-[4/5] overflow-visible">
                  <Image
                    src={heroMediaSrc}
                    alt="Bag of USA Gummies classic gummy bears"
                    fill
                    fetchPriority="low"
                    sizes="(max-width: 640px) 72vw, (max-width: 1024px) 50vw, 460px"
                    className="object-contain drop-shadow-[0_24px_48px_rgba(13,28,51,0.35)] z-10"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="americana-divider" aria-hidden="true" />

      <section className="bg-transparent" data-zone="VALUE" aria-label="Product value">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="group rounded-2xl border border-[rgba(15,27,45,0.10)] bg-white p-5 sm:p-6 transition-all duration-300 hover:shadow-[0_16px_40px_rgba(15,27,45,0.10)] hover:-translate-y-0.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-strong)] text-2xl shadow-xs">
                <span aria-hidden="true">🇺🇸</span>
              </div>
              <h3 className="mt-3 text-base font-black text-[var(--text)]">Made in the USA</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                Proudly sourced, manufactured, and packed in America. Every bag, every time.
              </p>
            </div>
            <div className="group rounded-2xl border border-[rgba(15,27,45,0.10)] bg-white p-5 sm:p-6 transition-all duration-300 hover:shadow-[0_16px_40px_rgba(15,27,45,0.10)] hover:-translate-y-0.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-strong)] text-2xl shadow-xs">
                <span aria-hidden="true">🌿</span>
              </div>
              <h3 className="mt-3 text-base font-black text-[var(--text)]">No artificial dyes</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                Colored naturally with real fruit and vegetable extracts. No Red 40, no Yellow 5.
              </p>
            </div>
            <div className="group rounded-2xl border border-[rgba(15,27,45,0.10)] bg-white p-5 sm:p-6 transition-all duration-300 hover:shadow-[0_16px_40px_rgba(15,27,45,0.10)] hover:-translate-y-0.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-strong)] text-2xl shadow-xs">
                <span aria-hidden="true">🍬</span>
              </div>
              <h3 className="mt-3 text-base font-black text-[var(--text)]">Classic gummy flavor</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                Soft, chewy texture with five all-natural fruit flavors in every bag.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="STANDARDS" aria-label="Brand standards">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <div className="text-center mb-6 sm:mb-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70 mb-2">
              Our standards
            </div>
            <h2 className="text-2xl font-black text-[var(--text)] sm:text-3xl">
              Standards, not slogans.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Made in America", icon: "🇺🇸", desc: "Sourced, manufactured, and packed entirely in the USA.", accent: "from-[var(--navy)] to-[#1a2d4f]" },
              { label: "No Artificial Dyes", icon: "🍇", desc: "Colored with real fruit and vegetable extracts — never synthetic dyes.", accent: "from-[#7b1f2f] to-[#a02040]" },
              { label: "All Natural Flavors", icon: "🍒", desc: "Five classic fruit flavors from natural sources in every bag.", accent: "from-[#1a5c2e] to-[#2a7a42]" },
            ].map((standard, i) => (
              <div key={standard.label} className={`group relative overflow-hidden rounded-[20px] shadow-[0_8px_24px_rgba(15,27,45,0.06)] transition-all duration-500 hover:shadow-[0_20px_48px_rgba(15,27,45,0.14)] hover:-translate-y-1 bg-gradient-to-br ${standard.accent} ${i === 2 ? "sm:col-span-2 lg:col-span-1" : ""}`}>
                <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true" style={{ backgroundImage: "url('/brand/pattern-stars.svg')", backgroundSize: "60px" }} />
                <div className="relative z-10 flex flex-col justify-end p-5 sm:p-6 min-h-[180px]">
                  <div className="text-3xl mb-3" aria-hidden="true">{standard.icon}</div>
                  <div className="text-base font-black text-white tracking-wide sm:text-lg">{standard.label}</div>
                  <p className="mt-1.5 text-[13px] text-white/70 leading-relaxed">{standard.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <div className="group relative overflow-hidden rounded-[20px] border border-[rgba(15,27,45,0.08)] aspect-[5/4] shadow-[0_8px_24px_rgba(15,27,45,0.06)] transition-all duration-500 hover:shadow-[0_20px_48px_rgba(15,27,45,0.14)]">
              <Image
                src="/brand/standards/lifestyle-forest.jpg"
                alt="USA Gummies bag on rustic wood table with American flags and loose gummy bears"
                fill
                sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 480px"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
            </div>
            <div className="flex flex-col justify-center rounded-[20px] border border-[rgba(15,27,45,0.08)] bg-white p-6 sm:p-8 shadow-[0_8px_24px_rgba(15,27,45,0.06)]">
              <p className="text-base text-[var(--muted)] text-pretty leading-relaxed sm:text-lg">
                Every bag of USA Gummies is made in the USA, colored with real fruit and vegetable
                extracts, and flavored with all&#8209;natural ingredients. These aren&apos;t marketing claims —
                they&apos;re the standards we hold ourselves to on every production run.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href="/ingredients" className="btn btn-outline">
                  See ingredients
                </Link>
                <Link href="/no-artificial-dyes-gummy-bears" className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] transition-colors">
                  Dye-free guide
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="BLOG">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <LatestFromBlog />
        </div>
      </section>

      <section className="bg-transparent" data-zone="FLAVORS">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <div className="candy-panel americana-panel rounded-[28px] p-5 sm:p-7">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70">
                  Inside every bag
                </div>
                <h2 className="mt-1 text-xl font-black text-[var(--text)] sm:text-2xl">
                  Five classic flavors.
                </h2>
              </div>
              <Link href="/ingredients" className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] transition-colors whitespace-nowrap">
                Ingredients &amp; allergen info
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { name: "Cherry", color: "#c0392b", highlight: "#e74c3c", shadow: "rgba(192,57,43,0.35)" },
                { name: "Lemon", color: "#d4a017", highlight: "#f1c40f", shadow: "rgba(212,160,23,0.35)" },
                { name: "Green Apple", color: "#27ae60", highlight: "#2ecc71", shadow: "rgba(39,174,96,0.35)" },
                { name: "Orange", color: "#d35400", highlight: "#e67e22", shadow: "rgba(211,84,0,0.35)" },
                { name: "Watermelon", color: "#c0392b", highlight: "#e84a5f", shadow: "rgba(232,74,95,0.35)" },
              ].map((flavor) => (
                <div key={flavor.name} className="group flex flex-col items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 transition-all duration-300 hover:shadow-[0_12px_32px_rgba(15,27,45,0.10)] hover:-translate-y-1">
                  <div className="relative h-16 w-16 sm:h-20 sm:w-20 flex items-center justify-center">
                    <div
                      className="h-12 w-10 sm:h-16 sm:w-13 rounded-[40%_40%_44%_44%] transition-transform duration-300 group-hover:scale-110"
                      aria-hidden="true"
                      style={{
                        background: `radial-gradient(ellipse 60% 40% at 35% 30%, ${flavor.highlight}cc, ${flavor.color}ee 60%, ${flavor.color} 100%)`,
                        boxShadow: `0 6px 16px ${flavor.shadow}, inset 0 -4px 8px rgba(0,0,0,0.15), inset 0 2px 6px rgba(255,255,255,0.3)`,
                      }}
                    />
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: flavor.color }} />
                    <span className="text-sm font-bold text-[var(--text)]">{flavor.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneReviews}`} data-zone="REVIEWS">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 py-6 lg:py-10 reveal-up">
            <ReviewsSection />
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="SHIPPING">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <div className="grid gap-4 rounded-[28px] border border-[rgba(15,27,45,0.08)] bg-white p-6 sm:p-8 lg:grid-cols-[1fr_240px] lg:items-center shadow-[0_8px_24px_rgba(15,27,45,0.05)]">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70">
                Shipping &amp; fulfillment
              </div>
              <h2 className="text-xl font-black text-[var(--text)] sm:text-2xl">
                Ships within 24 hours.
              </h2>
              <p className="text-base text-[var(--muted)] max-w-md">
                Every order packed with care and shipped fast. Satisfaction guaranteed, every time.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="badge badge--navy">Fast fulfillment</span>
                <span className="badge badge--navy">{FREE_SHIPPING_PHRASE}</span>
                <span className="badge badge--navy">Packed with care</span>
              </div>
            </div>
            <div className="justify-self-center lg:justify-self-end">
              <Image
                src="/website%20assets/Truck.png"
                alt="Delivery truck illustration"
                aria-hidden="true"
                width={1920}
                height={1080}
                sizes="(max-width: 640px) 180px, 240px"
                className="brand-touch h-auto w-full max-w-[200px] object-contain sm:max-w-[240px]"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--surface-strong)]" data-zone="STORY" id="why-usa-gummies">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12 reveal-up">
          <div className="candy-panel americana-panel relative overflow-hidden rounded-[36px] p-5 sm:p-8">
            <div className="relative z-10">
              <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                <div className="space-y-4">
                  <div className="flex justify-center lg:justify-start">
                    <Image
                      src="/website%20assets/MtRushmore.png"
                      alt="Mount Rushmore illustration"
                      aria-hidden="true"
                      width={1398}
                      height={857}
                      sizes="(max-width: 640px) 200px, (max-width: 1024px) 260px, 320px"
                      className="brand-touch h-auto w-full max-w-[200px] sm:max-w-[260px] lg:max-w-[320px] object-contain"
                    />
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Image
                      src="/brand/logo.png"
                      alt="USA Gummies logo"
                      aria-hidden="true"
                      width={64}
                      height={20}
                      className="brand-logo-mark"
                    />
                    <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]">
                      Why USA Gummies
                    </div>
                  </div>
                  <h2 className="text-balance text-2xl font-black text-[var(--text)] sm:text-3xl">
                    Why USA Gummies matters.
                  </h2>
                  <p className="text-pretty text-base text-[var(--muted)] leading-relaxed">
                    Proudly sourced, manufactured, and packed entirely in America. No artificial
                    dyes or synthetic colors. Classic gummy bear flavor — done right.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <a href="#bundle-pricing" className="btn btn-candy text-base px-6 py-3">
                      Shop now
                    </a>
                    <Link
                      href="/shop#product-details"
                      className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] focus-ring transition-colors"
                    >
                      View product details
                    </Link>
                  </div>
                </div>

                <div className="space-y-3 lg:pt-1">
                  <div className="candy-panel americana-panel relative overflow-hidden rounded-3xl p-2 text-[var(--text)] lg:ml-auto lg:max-w-[440px]">
                    <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[rgba(15,27,45,0.1)] bg-[var(--surface-strong)] p-3">
                      <Image
                        src={whyImageSrc}
                        alt={whyImageAlt}
                        fill
                        sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 440px"
                        className="object-contain"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 via-black/0 to-transparent p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/90">
                          Made in USA
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 space-y-1.5 px-1 pb-1">
                      <div className="text-base font-black text-[var(--text)]">
                        Classic gummy bear flavor — done right.
                      </div>
                      <div className="text-pretty text-sm text-[var(--muted)] leading-relaxed">
                        All the chewy, fruity flavor you expect, without artificial dyes or harsh aftertaste.
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className="badge badge--navy">Made in USA</span>
                        <span className="badge badge--navy">No artificial dyes</span>
                        <span className="badge badge--navy">{FREE_SHIPPING_PHRASE}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--surface-strong)]" data-zone="BENEFITS">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <div className="grid gap-6 lg:grid-cols-[240px_1fr] lg:items-end">
            <div className="flex items-end justify-center lg:justify-start">
              <Image
                src="/website%20assets/Jeep.png"
                alt="Vintage Jeep illustration"
                aria-hidden="true"
                width={1041}
                height={701}
                sizes="(max-width: 640px) 180px, (max-width: 1024px) 240px, 300px"
                className="brand-touch h-auto w-full max-w-[200px] sm:max-w-[240px] lg:max-w-[300px] object-contain"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {whyCards.map((card) => (
                <div
                  key={card.title}
                  className="candy-panel relative overflow-hidden rounded-2xl p-5 sm:p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(15,27,45,0.12)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-strong)] shadow-xs">
                      {card.icon}
                    </div>
                    <h3 className="text-lg font-black text-[var(--text)]">{card.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{card.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneEmail}`} data-zone="EMAIL">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 reveal-up">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="candy-panel americana-panel rounded-[28px] p-5 sm:p-6 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Image
                        src="/brand/logo.png"
                        alt="USA Gummies logo"
                        aria-hidden="true"
                        width={64}
                        height={20}
                        className="brand-logo-mark"
                      />
                      <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                        Follow the fun
                      </div>
                    </div>
                    <h2 className="mt-1 text-2xl font-black text-[var(--text)]">
                      Follow along with USA Gummies
                    </h2>
                    <div className="mt-2 text-sm text-[var(--muted)]">
                      Behind-the-scenes drops, customer moments, and fresh gummy goodness.
                    </div>
                  </div>
                  <Link
                    href="https://www.instagram.com/usagummies/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline"
                  >
                    Follow
                  </Link>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
                  {SOCIAL_LINKS.map((social) => (
                    <a
                      key={social.name}
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-3 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3 transition hover:border-[rgba(15,27,45,0.2)] hover:shadow-[0_10px_24px_rgba(15,27,45,0.12)]"
                      aria-label={`Follow USA Gummies on ${social.name}`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--text)]">
                        {social.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--text)]">
                          {social.name}
                        </span>
                        <span className="block text-[11px] text-[var(--muted)]">{social.label}</span>
                      </span>
                    </a>
                  ))}
                </div>

                <div className="mt-3 text-xs text-[var(--muted)]">
                  Tap any channel to follow and stay in the loop.
                </div>
              </div>
              <div className="candy-panel americana-panel relative overflow-hidden rounded-[28px] p-5 sm:p-6 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
                <div className="space-y-4">
                  <div className="flex items-center gap-2.5">
                    <Image
                      src="/brand/logo.png"
                      alt="USA Gummies logo"
                      aria-hidden="true"
                      width={64}
                      height={20}
                      className="brand-logo-mark"
                    />
                    <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]">
                      Get updates
                    </div>
                  </div>
                  <h2 className="text-xl font-black text-[var(--text)] sm:text-2xl">
                    Unlock early access + member-only drops
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    First dibs on limited drops, restocks, and member-only savings alerts.
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)] w-fit">
                    VIP early access • limited-batch alerts
                  </div>
                  <form className="flex flex-wrap gap-3 items-center rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-1.5">
                    <input
                      type="email"
                      name="email"
                      placeholder="Enter your email"
                      className="flex-1 min-w-[220px] rounded-full border border-[rgba(15,27,45,0.15)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.35)]"
                      aria-label="Enter your email for updates"
                      required
                    />
                    <button type="submit" className="btn btn-outline pressable px-5 py-3 font-semibold w-full sm:w-auto">
                      Sign me up
                    </button>
                  </form>
                  <div className="text-[11px] text-[var(--muted)]">
                    No spam. Just drops, restocks, and savings alerts.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="STORY">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <div className="candy-panel americana-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8 lg:p-10">
            <div className="flex items-center gap-2.5">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies logo"
                aria-hidden="true"
                width={64}
                height={20}
                className="brand-logo-mark"
              />
              <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]">
                Our story
              </div>
            </div>
            <h2 className="text-balance mt-3 text-2xl font-black text-[var(--text)] sm:text-3xl lg:text-4xl">
              {BRAND_STORY_HEADLINE}
            </h2>
            <div className="mt-4 copy-stack copy-stack--rail text-base text-[var(--muted)] text-pretty leading-relaxed max-w-prose">
              {BRAND_STORY_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Link href="/shop" className="btn btn-candy text-base px-6 py-3">
                Shop now
              </Link>
              <Link
                href="/about"
                className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] focus-ring transition-colors"
              >
                Read our full story
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="WHOLESALE">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <div className="relative overflow-hidden rounded-[28px] border border-[rgba(15,27,45,0.10)] bg-[var(--navy)] p-6 sm:p-8 lg:p-10">
            <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true" style={{ backgroundImage: "url('/brand/pattern-stars.svg')", backgroundSize: "120px", mixBlendMode: "overlay" }} />
            <div className="relative z-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/50">
                  Wholesale partnerships
                </div>
                <h2 className="text-2xl font-black text-white sm:text-3xl">
                  Bring USA Gummies to your shelves.
                </h2>
                <p className="text-base text-white/70 max-w-md leading-relaxed">
                  Retail-ready patriotic packaging, clean ingredients, and a brand story that sells. Request a starter case or samples today.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">Made in USA</span>
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">Shelf-ready format</span>
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">FDA-registered facility</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link href="/wholesale" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[var(--navy)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-300 hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)] hover:-translate-y-0.5">
                    Request wholesale info
                  </Link>
                  <Link href="/contact" className="text-sm font-semibold text-white/70 underline underline-offset-4 hover:text-white transition-colors">
                    Contact us
                  </Link>
                </div>
              </div>
              <div className="flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[280px] sm:max-w-[320px]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="Assorted USA Gummies bags for wholesale"
                      fill
                      sizes="(max-width: 640px) 280px, 320px"
                      className="object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneFooter}`} aria-hidden="true">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 py-5 sm:py-6">
            <div className="h-10 sm:h-12 lg:h-16" />
          </div>
        </div>
      </section>

      <LazyStickyAddToCartBar
        title="In your cart"
        imageUrl={heroImage}
        imageAlt={heroImageAlt}
        buttonLabel="Buy now"
        source="home"
      />

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
        availability={bundleVariants?.availableForSale === false ? "OutOfStock" : "InStock"}
        aggregateRating={
          reviewAggregate
            ? {
                ratingValue: reviewAggregate.ratingValue,
                reviewCount: reviewAggregate.reviewCount,
              }
            : null
        }
      />

      <LazyHeroCTAWatcher />
    </main>
  );
}
