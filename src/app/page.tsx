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
import { BRAND_STORY_HEADLINE, BRAND_STORY_SHORT } from "@/data/brandStory";
import { DETAIL_BULLETS } from "@/data/productDetails";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { LazyStickyAddToCartBar } from "@/components/product/LazyStickyAddToCartBar.client";
import LazyHeroCTAWatcher from "@/components/home/LazyHeroCTAWatcher.client";
import FAQSection from "@/components/home/FAQSection";
import StickyShopCTA from "@/components/home/StickyShopCTA.client";
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

  return (
    <div className="home-light-wrap relative overflow-hidden min-h-screen">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
        ]}
      />

      {/* ─── 1. BUNDLE — the money maker ─── */}
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

      {/* ─── 2. HERO — brand statement + product shot ─── */}
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
                <blockquote className="border-l-2 border-[var(--gold)]/40 pl-3 mt-1">
                  <p className="text-[13px] italic text-white/70 leading-snug">
                    &ldquo;Absolutely delicious soft gummy bears made in America. You will not be disappointed!&rdquo;
                  </p>
                  <cite className="mt-0.5 block text-[11px] font-semibold not-italic text-white/50">
                    — Michael D., verified buyer
                  </cite>
                </blockquote>
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
                    {FREE_SHIPPING_PHRASE} • Ships in 24 hours • Satisfaction guaranteed
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      Made in USA
                    </span>
                    <span className="theme-pill rounded-full border border-white/20 bg-white/95 px-3.5 py-1.5 text-[var(--navy)] shadow-xs">
                      No artificial dyes
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

      {/* ─── 3. STANDARDS — visual proof, not slogans ─── */}
      <section className="section-light" data-zone="STANDARDS" aria-label="Brand standards">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10 lg:py-14">
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
              { label: "Made in America", src: "/brand/standards/made-in-america.jpg", alt: "Made in America isn't a slogan — it's a standard. Real gummy bears with American flag." },
              { label: "No Artificial Dyes", src: "/brand/standards/no-artificial-dyes.jpg", alt: "No artificial dyes isn't a slogan — it's a standard. Real gummy bears with American flag." },
              { label: "All Natural Flavors", src: "/brand/standards/all-natural-flavors.jpg", alt: "All natural flavors isn't a slogan — it's a standard. Real gummy bears with American flag." },
            ].map((standard, i) => (
              <div key={standard.label} className={`group relative overflow-hidden rounded-[20px] border border-[rgba(15,27,45,0.08)] aspect-[1/1] shadow-[0_8px_24px_rgba(15,27,45,0.06)] transition-all duration-500 hover:shadow-[0_20px_48px_rgba(15,27,45,0.14)] hover:-translate-y-1 ${i === 2 ? "sm:col-span-2 lg:col-span-1" : ""}`}>
                <Image
                  src={standard.src}
                  alt={standard.alt}
                  fill
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 360px"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
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
                unoptimized
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

      {/* ─── 4. REVIEWS — social proof ─── */}
      <section className={`${styles.scene} ${styles.sceneReviews} home-hero-theme`} data-zone="REVIEWS">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 py-6 lg:py-8 reveal-up">
            <ReviewsSection />
          </div>
        </div>
      </section>

      {/* ─── 5. FLAVORS — product detail ─── */}
      <section className="section-light" data-zone="FLAVORS">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10 lg:py-14">
          <div className="rounded-[28px] border border-[rgba(15,27,45,0.08)] bg-white p-5 sm:p-7 shadow-[0_8px_24px_rgba(15,27,45,0.04)]">
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
                { name: "Cherry", color: "#c0392b", img: "/brand/gummies/gummy-red.jpg" },
                { name: "Lemon", color: "#d4a017", img: "/brand/gummies/gummy-yellow.jpg" },
                { name: "Green Apple", color: "#27ae60", img: "/brand/gummies/gummy-green.jpg" },
                { name: "Orange", color: "#d35400", img: "/brand/gummies/gummy-orange.jpg" },
                { name: "Watermelon", color: "#e84a5f", img: "/brand/gummies/gummy-pink.jpg" },
              ].map((flavor) => (
                <div key={flavor.name} className="group flex flex-col items-center rounded-2xl border border-[rgba(15,27,45,0.06)] bg-white p-4 transition-all duration-300 hover:shadow-[0_12px_32px_rgba(15,27,45,0.12)] hover:-translate-y-1">
                  <div className="relative h-20 w-20 sm:h-24 sm:w-24">
                    <Image
                      src={flavor.img}
                      alt={`${flavor.name} gummy bear — real product photo`}
                      fill
                      sizes="96px"
                      className="object-contain transition-transform duration-300 group-hover:scale-110"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: flavor.color }} />
                    <span className="text-sm font-bold text-[var(--text)]">{flavor.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 6. STORY — one tight brand story ─── */}
      <section className="section-light" data-zone="STORY">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10 lg:py-14">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div className="flex justify-center">
              <Image
                src="/website%20assets/MtRushmore.png"
                alt="Mount Rushmore illustration"
                aria-hidden="true"
                width={1398}
                height={857}
                sizes="(max-width: 640px) 240px, (max-width: 1024px) 320px, 400px"
                className="brand-touch h-auto w-full max-w-[240px] sm:max-w-[320px] lg:max-w-[400px] object-contain"
              />
            </div>
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
                  Our story
                </div>
              </div>
              <h2 className="text-balance text-2xl font-black text-[var(--text)] sm:text-3xl">
                {BRAND_STORY_HEADLINE}
              </h2>
              <div className="space-y-3 text-base text-[var(--muted)] text-pretty leading-relaxed max-w-prose">
                {BRAND_STORY_SHORT.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-2">
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
        </div>
      </section>

      {/* ─── 7. FAQ — address buying objections ─── */}
      <section className="section-light" data-zone="FAQ" aria-label="Frequently asked questions">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10 lg:py-14">
          <FAQSection />
        </div>
      </section>

      {/* ─── 8. WHOLESALE — readable pills, clear CTA ─── */}
      <section className="section-light" data-zone="WHOLESALE">
        <div className="mx-auto max-w-6xl px-4 pb-0">
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
                  <span className="rounded-full border border-white/40 bg-white px-3.5 py-1.5 text-[11px] font-bold text-[#0d1c33]">Made in USA</span>
                  <span className="rounded-full border border-white/40 bg-white px-3.5 py-1.5 text-[11px] font-bold text-[#0d1c33]">Shelf-ready format</span>
                  <span className="rounded-full border border-white/40 bg-white px-3.5 py-1.5 text-[11px] font-bold text-[#0d1c33]">FDA-registered facility</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link href="/wholesale" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[var(--navy)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-300 hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)] hover:-translate-y-0.5">
                    Request wholesale info
                  </Link>
                  <Link href="/contact" className="text-sm font-semibold text-white/90 underline underline-offset-4 hover:text-white transition-colors">
                    Contact us
                  </Link>
                </div>
              </div>
              <div className="flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[320px] sm:max-w-[380px]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.3)]">
                    <Image
                      src="/brand/extras/wholesale-shelf.jpg"
                      alt="USA Gummies retail shelf display — America is taking its shelf space back"
                      fill
                      sizes="(max-width: 640px) 320px, 380px"
                      className="object-cover"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <StickyShopCTA />

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
    </div>
  );
}
