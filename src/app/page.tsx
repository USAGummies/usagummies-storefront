import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import BagSlider from "@/components/purchase/BagSlider.client";
import ReviewsSection from "@/components/home/ReviewsSection";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { BRAND_STORY_HEADLINE, BRAND_STORY_PARAGRAPHS } from "@/data/brandStory";
import { DETAIL_BULLETS } from "@/data/productDetails";
import { getReviewAggregate } from "@/lib/reviews/aggregate";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import LazyHeroCTAWatcher from "@/components/home/LazyHeroCTAWatcher.client";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";
import { DyeFreeNewsBanner } from "@/components/marketing/DyeFreeNewsBanner";
import { TrustBar, GuaranteeBadge } from "@/components/social-proof/TrustBar";
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
  "Shop patriotic candy made in the USA. Dye-free gummies with no artificial dyes, plus bundles and gifts for any celebration.";
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

  const heroImage = productImages[0]?.url || `${SITE_URL}/brand/usa-gummies-family.webp`;
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

      {/* ── DRAMATIC HERO ── */}
      <section className="relative overflow-hidden" data-zone="BRAND_HERO">
        <div className="absolute inset-0 z-0">
          <Image
            src="/brand/lifestyle/picnic-scene.jpg"
            alt="USA Gummies bag on a picnic table with American flag"
            fill
            priority
            fetchPriority="high"
            sizes="100vw"
            className="object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/30 to-[#1B2A4A]/60" />
        </div>
        <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-4 py-16 sm:py-20 lg:py-28 text-center">
          <Image
            src="/brand/logo-full.png"
            alt="USA Gummies — American-made gummy bears"
            width={440}
            height={280}
            priority
            className="h-auto w-[260px] sm:w-[340px] lg:w-[440px] drop-shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          />
          <h1 className="mt-6 font-display text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            America&rsquo;s Gummy Bear
          </h1>
          <p className="mt-3 max-w-lg text-sm text-white/90 sm:text-base drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
            Classic gummy bears, made in the USA. No artificial dyes. Just real fruit colors and all-natural flavor.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a href="#hero-primary-cta" className="inline-flex items-center gap-2 rounded-full bg-[#c7362c] px-7 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-[#a82c24] hover:shadow-xl">
              Shop now
            </a>
            <Link href="/about" className="inline-flex items-center gap-2 rounded-full border-2 border-white/40 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-white/70 hover:bg-white/10">
              Our story
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
              Made in USA
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
              No artificial dyes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
              {FREE_SHIPPING_PHRASE}
            </span>
          </div>
        </div>
      </section>

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
                    <BagSlider variant="full" defaultQty={5} />
                  </div>
                  <div className="mt-3">
                    <GuaranteeBadge />
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <TrustBar variant="compact" />
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
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-product-stage" data-zone="HERO">
        <div className="mx-auto max-w-6xl px-4 py-0.5 sm:py-1.5 lg:py-2">
          <div className="relative grid gap-1 lg:gap-2 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div className="order-2 relative lg:order-1">
              <div className="relative z-10 space-y-0.5">
                <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-[#1B2A4A]/70">
                  <Image
                    src="/brand/logo.png"
                    alt="USA Gummies logo"
                    width={110}
                    height={36}
                    className="h-7 w-auto"
                  />
                  <span>USA Gummies</span>
                </div>
                <h1 className="text-balance text-[32px] font-black leading-[1.05] tracking-tight text-[#1B2A4A] sm:text-4xl lg:text-5xl">
                  All-American Gummy Bears
                </h1>
                <p className="text-pretty text-[12px] text-[#1B2A4A]/85 sm:text-sm">
                  Classic gummy bears, made in the USA.
                </p>
                <div className="text-sm font-semibold text-[#1B2A4A]">
                  No artificial dyes • All natural flavors
                </div>
                <div className="text-xs font-semibold text-[var(--gold)]">
                  4.8 stars from verified Amazon buyers
                </div>
                <div className="pt-0 space-y-0.5">
                  <div className="text-xs font-semibold text-[#1B2A4A]/70">
                    Lower the per-bag price at 4+ bags.
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href="#bundle-pricing" className="btn btn-candy">
                      Shop &amp; save
                    </Link>
                    <a href="#bundle-pricing" className="hero-scroll-link" data-hero-scroll>
                      Jump to bundle pricing
                    </a>
                  </div>
                  <div className="text-xs font-semibold text-[#1B2A4A]/70">
                    {FREE_SHIPPING_PHRASE} • Satisfaction guaranteed
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-semibold text-[#1B2A4A]/70">
                    <span className="theme-pill rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[var(--navy)]">
                      Made in USA
                    </span>
                    <span className="theme-pill rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[var(--navy)]">
                      Ships in 24 hours
                    </span>
                    <span className="theme-pill rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[var(--navy)]">
                      Secure checkout
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 hidden justify-center sm:flex lg:order-2 lg:justify-end">
              <div className="home-hero__media relative w-full max-w-[240px] sm:max-w-[340px] lg:max-w-[420px]">
                <div className="relative aspect-[4/5] overflow-visible">
                  <Image
                    src={heroMediaSrc}
                    alt="Bag of USA Gummies classic gummy bears"
                    fill
                    fetchPriority="low"
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 55vw, 640px"
                    className="object-contain drop-shadow-[0_18px_30px_rgba(13,28,51,0.22)] z-10"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LOGO DIVIDER ── */}
      <div className="flex items-center justify-center gap-4 py-4" aria-hidden="true">
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
        <Image
          src="/brand/logo.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={16}
          className="h-3 w-auto opacity-30"
        />
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
      </div>

      <section className="bg-transparent" data-zone="VALUE" aria-label="Product value">
        <div className="mx-auto max-w-6xl px-4 py-0.5 sm:py-0.5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-lg">
                  <span aria-hidden="true">🇺🇸</span>
                </div>
                <div className="text-[13px] font-black text-[var(--text)]">Made in the USA</div>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Proudly sourced, manufactured, and packed in America.
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-lg">
                  <span aria-hidden="true">🌿</span>
                </div>
                <div className="text-[13px] font-black text-[var(--text)]">No artificial dyes</div>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Colored naturally using real fruit and vegetable extracts.
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-lg">
                  <span aria-hidden="true">🍬</span>
                </div>
                <div className="text-[13px] font-black text-[var(--text)]">Classic gummy flavor</div>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Soft, chewy texture with all‑natural fruit flavors.
              </p>
            </div>
          </div>
        </div>
      </section>

      <DyeFreeNewsBanner />

      {/* ── BRAND GALLERY ── */}
      <section className="bg-[#f8f5ef]" data-zone="GALLERY">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Image
              src="/brand/logo.png"
              alt="USA Gummies logo"
              aria-hidden="true"
              width={80}
              height={26}
              className="h-5 w-auto opacity-60"
            />
          </div>
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#1B2A4A]/60">
              The brand
            </div>
            <h2 className="mt-1 text-2xl font-black text-[#1B2A4A] sm:text-3xl">
              Made for moments that matter.
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#1B2A4A]/70">
              From backyard cookouts to road trips across the heartland, USA Gummies belong wherever America gathers.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/gallery/bag-flag-hero.jpg"
                alt="USA Gummies bag with American flag backdrop and gummy bears"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/lifestyle/woman-enjoying.jpg"
                alt="Woman enjoying USA Gummies"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/gallery/neon-sign.jpg"
                alt="USA Gummies neon sign on brick wall"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/gallery/bears-lineup-flag.jpg"
                alt="Five gummy bears in a row with American flag"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/lifestyle/picnic-scene.jpg"
                alt="USA Gummies bag on an American picnic table"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/brand/gallery/bag-flag-bears.jpg"
                alt="USA Gummies — Real Fruit Colors, Zero Artificial Dyes"
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent" data-zone="BLOG">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <LatestFromBlog />
        </div>
      </section>

      <section className="bg-[#f8f5ef]" data-zone="FLAVORS">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies logo"
                aria-hidden="true"
                width={64}
                height={20}
                className="h-4 w-auto opacity-50"
              />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#1B2A4A]/60">
              Inside every bag
            </div>
            <h2 className="mt-1 text-xl font-black text-[#1B2A4A] sm:text-2xl">
              Five classic gummy bear flavors.
            </h2>
          </div>
          <div className="mt-6 flex flex-wrap items-stretch justify-center gap-4 sm:gap-6">
            {[
              { src: "/brand/gummies/gummy-pink.png", alt: "Cherry gummy bear", name: "Cherry", color: "#c7362c" },
              { src: "/brand/gummies/gummy-yellow.png", alt: "Lemon gummy bear", name: "Lemon", color: "#d4a017" },
              { src: "/brand/gummies/gummy-green.png", alt: "Green Apple gummy bear", name: "Green Apple", color: "#2D7A3A" },
              { src: "/brand/gummies/gummy-orange.png", alt: "Orange gummy bear", name: "Orange", color: "#d4702a" },
              { src: "/brand/gummies/gummy-red.png", alt: "Watermelon gummy bear", name: "Watermelon", color: "#a03050" },
            ].map((bear) => (
              <div key={bear.name} className="flex flex-col items-center gap-2 rounded-2xl border border-[rgba(15,27,45,0.08)] bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md" style={{ minWidth: "100px" }}>
                <Image
                  src={bear.src}
                  alt={bear.alt}
                  width={80}
                  height={80}
                  className="h-[60px] w-[60px] object-contain sm:h-[80px] sm:w-[80px] drop-shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
                />
                <span className="text-xs font-bold text-[#1B2A4A] sm:text-sm">{bear.name}</span>
                <span className="inline-block h-1 w-6 rounded-full" style={{ backgroundColor: bear.color }} />
              </div>
            ))}
          </div>
          <div className="mt-4 text-center text-xs text-[#1B2A4A]/60">
            All colored naturally with real fruit and vegetable extracts.{" "}
            <Link href="/ingredients" className="font-semibold text-[#1B2A4A] underline underline-offset-4">
              Ingredients &amp; allergen info
            </Link>
          </div>
        </div>
      </section>

      {/* ── LOGO DIVIDER ── */}
      <div className="flex items-center justify-center gap-4 py-4 bg-[#f8f5ef]" aria-hidden="true">
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
        <Image
          src="/brand/logo.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={16}
          className="h-3 w-auto opacity-30"
        />
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
      </div>

      {/* ── MADE IN AMERICA ── */}
      <section className="bg-[#f5f1ea]" data-zone="AMERICANA">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14 lg:py-16">
          <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/brand/logo-full.png"
                  alt="USA Gummies logo"
                  aria-hidden="true"
                  width={160}
                  height={102}
                  className="h-auto w-[120px] sm:w-[160px]"
                />
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#1B2A4A]/50">
                Made in America
              </div>
              <h2 className="text-balance text-2xl font-black leading-tight text-[#1B2A4A] sm:text-3xl lg:text-4xl">
                Made in America isn&rsquo;t a slogan. It&rsquo;s a standard.
              </h2>
              <p className="text-pretty text-sm leading-relaxed text-[#1B2A4A]/70 sm:text-base">
                Every bag of USA Gummies is sourced, manufactured, and packed entirely
                in the United States. We chose American production not because it was
                easy, but because it was right. Real fruit colors. No artificial dyes.
                A gummy bear you can trust.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1B2A4A]/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1B2A4A]/80">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
                  American sourced
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1B2A4A]/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1B2A4A]/80">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
                  American manufactured
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1B2A4A]/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1B2A4A]/80">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2D7A3A]" />
                  American packed
                </span>
              </div>
              <div className="pt-2">
                <a href="#hero-primary-cta" className="inline-flex items-center gap-2 rounded-full bg-[#c7362c] px-7 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-[#a82c24]">
                  Shop USA Gummies
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl shadow-lg">
                <Image
                  src="/brand/americana/washington-crossing.jpg"
                  alt="Washington crossing the Delaware holding USA Gummies"
                  fill
                  sizes="(max-width: 640px) 50vw, 280px"
                  className="object-cover"
                />
              </div>
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl shadow-lg">
                <Image
                  src="/brand/americana/founding-fathers-fireside.jpg"
                  alt="Founding fathers sharing USA Gummies by the fireplace"
                  fill
                  sizes="(max-width: 640px) 50vw, 280px"
                  className="object-cover"
                />
              </div>
              <div className="relative col-span-2 aspect-[16/7] overflow-hidden rounded-2xl shadow-lg">
                <Image
                  src="/brand/americana/crossing-freedom.jpg"
                  alt="From Fake to Freedom — USA Gummies crossing scene"
                  fill
                  sizes="(max-width: 640px) 100vw, 560px"
                  className="object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1B2A4A]/60 to-transparent p-4">
                  <div className="text-center text-xs font-bold uppercase tracking-widest text-white/90">
                    From fake dyes to freedom
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white" data-zone="REVIEWS">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:py-8 reveal-up">
          <ReviewsSection />
        </div>
      </section>

      <section className="bg-transparent" data-zone="SHIPPING">
        <div className="mx-auto max-w-6xl px-4 pb-3">
          <div className="grid gap-3 rounded-[28px] border border-[rgba(15,27,45,0.12)] bg-white p-3 sm:p-4 lg:grid-cols-[1fr_200px] lg:items-center">
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Shipping &amp; fulfillment
              </div>
              <div className="text-[15px] font-black text-[var(--text)] sm:text-base">
                Ships within 24 hours, every order packed with care.
              </div>
              <div className="text-sm font-semibold text-[var(--text)]">
                Satisfaction guaranteed.
              </div>
            </div>
            <div className="justify-self-end">
              <Image
                src="/website%20assets/Truck.png"
                alt="Delivery truck illustration"
                aria-hidden="true"
                width={1920}
                height={1080}
                sizes="(max-width: 640px) 150px, 210px"
                className="brand-touch h-auto w-full max-w-[170px] object-contain sm:max-w-[210px]"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--surface-strong)]" data-zone="STORY" id="why-usa-gummies">
        <div className="mx-auto max-w-6xl px-4 py-4 lg:py-5 reveal-up">
          <div className="candy-panel americana-panel relative overflow-hidden rounded-[36px] p-3 sm:p-4">
            <div className="relative z-10">
              <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                <div className="space-y-1.5">
                  <div className="flex justify-center lg:justify-start">
                    <Image
                      src="/website%20assets/MtRushmore.png"
                      alt="Mount Rushmore illustration"
                      aria-hidden="true"
                      width={1398}
                      height={857}
                      sizes="(max-width: 640px) 180px, (max-width: 1024px) 240px, 280px"
                      className="brand-touch h-auto w-full max-w-[180px] sm:max-w-[220px] lg:max-w-[280px] object-contain"
                    />
                  </div>
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
                      Why USA Gummies
                    </div>
                  </div>
                  <h2 className="text-balance text-xl font-black text-[var(--text)] sm:text-2xl">
                    Why USA Gummies matters.
                  </h2>
                  <p className="text-pretty text-sm text-[var(--muted)]">
                    Proudly sourced, manufactured, and packed entirely in America. No artificial
                    dyes or synthetic colors. Classic gummy bear flavor — done right.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    <a href="#bundle-pricing" className="btn btn-candy">
                      Shop now
                    </a>
                    <Link
                      href="/shop#product-details"
                      className="text-xs font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] focus-ring"
                    >
                      View product details
                    </Link>
                  </div>
                </div>

                <div className="space-y-1.5 lg:pt-1">
                  <div className="candy-panel americana-panel relative overflow-hidden rounded-3xl p-1.5 text-[var(--text)] lg:ml-auto lg:max-w-[400px]">
                    <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[rgba(15,27,45,0.1)] bg-[var(--surface-strong)] p-3">
                      <Image
                        src={whyImageSrc}
                      alt={whyImageAlt}
                      fill
                      sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 420px"
                      className="object-contain"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 via-black/0 to-transparent p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/90">
                        Made in USA
                      </div>
                    </div>
                  </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="text-sm font-black text-[var(--text)]">
                        Classic gummy bear flavor — done right.
                      </div>
                    <div className="text-pretty text-xs text-[var(--muted)]">
                      All the chewy, fruity flavor you expect, without artificial dyes or harsh aftertaste.
                    </div>
                    <div className="flex flex-wrap gap-2">
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
        <div className="mx-auto max-w-6xl px-4 pb-5">
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="flex items-end justify-start">
              <Image
                src="/website%20assets/Jeep.png"
                alt="Vintage Jeep illustration"
                aria-hidden="true"
                width={1041}
                height={701}
                sizes="(max-width: 640px) 160px, (max-width: 1024px) 220px, 280px"
                className="brand-touch h-auto w-full max-w-[180px] sm:max-w-[220px] lg:max-w-[280px] object-contain"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {whyCards.map((card) => (
                <div
                  key={card.title}
                  className="candy-panel relative overflow-hidden rounded-2xl p-2.5 sm:p-3 transition-transform duration-200 hover:-translate-y-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)]">
                      {card.icon}
                    </div>
                    <div className="text-base font-black text-[var(--text)]">{card.title}</div>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{card.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f8f5ef]" data-zone="EMAIL">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:py-8 reveal-up">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="candy-panel americana-panel rounded-[28px] p-3 sm:p-4 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
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
              <div className="candy-panel americana-panel relative overflow-hidden rounded-[28px] p-3 sm:p-4 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
                <div className="space-y-3">
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
      </section>

      <section className="bg-transparent" data-zone="STORY">
        <div className="mx-auto max-w-6xl px-4 py-5">
          <div className="candy-panel americana-panel rounded-[36px] border border-[var(--border)] p-4 sm:p-5">
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
                Our story
              </div>
            </div>
            <h2 className="text-balance mt-2 text-2xl font-black text-[var(--text)] sm:text-3xl">
              {BRAND_STORY_HEADLINE}
            </h2>
            <div className="mt-3 copy-stack copy-stack--rail text-sm text-[var(--muted)] text-pretty">
              {BRAND_STORY_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                href="/about"
                className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] focus-ring"
              >
                Read our story
              </Link>
              <Link href="/shop" className="btn btn-candy">
                Shop now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom breathing room — clean cream, no grey scene overlay */}
      <div className="h-10 sm:h-12 lg:h-16 bg-transparent" aria-hidden="true" />

      <BagSlider variant="sticky" defaultQty={5} />

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
