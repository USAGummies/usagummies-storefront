import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import ReviewsSection from "@/components/home/ReviewsSection";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import HeroCTAWatcher from "@/components/home/HeroCTAWatcher";
import { BRAND_STORY_HEADLINE, BRAND_STORY_PARAGRAPHS } from "@/data/brandStory";
import { DETAIL_BULLETS } from "@/data/productDetails";
import styles from "./homepage-scenes.module.css";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE =
  "USA Gummies - All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors";
const PAGE_DESCRIPTION =
  "USA Gummies - All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors.";
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
    href: "https://www.facebook.com/profile.php?id=61581802793282#",
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
  const whyImageSrc = whyImage?.url || "/home-patriotic-product.jpg";
  const whyImageAlt = whyImage?.altText || "USA Gummies in hand";

  const heroMediaSrc = "/website%20assets/hero.jpg";
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

  const whyCards = [
    {
      title: "Made in the USA",
      copy: "Proudly sourced, manufactured, and packed entirely in America.",
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--candy-red)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 10.2 12 5l9 5.2v8.3H3v-8.3zm9-2.9-6.2 3.6h12.4L12 7.3zM7 12h2v5H7v-5zm4 0h2v5h-2v-5zm4 0h2v5h-2v-5z"
          />
        </svg>
      ),
    },
    {
      title: "No artificial dyes",
      copy: "Colored naturally using real fruit and vegetable extracts.",
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--candy-green)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3c4 3 6 6.3 6 9.6A6 6 0 0 1 6 12.6C6 9.3 8 6 12 3zm0 3.2C9.4 8.2 8 10.2 8 12.6a4 4 0 1 0 8 0c0-2.4-1.4-4.4-4-6.4z"
          />
        </svg>
      ),
    },
    {
      title: "Classic gummy bear flavor",
      copy: "Chewy, fruity flavor without artificial ingredients or harsh aftertaste.",
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--candy-orange)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h16v3H4V6zm0 5h16v7H4v-7zm5-4h6v-1H9v1zm3 6 3.5 2-1.2 1.8L12 15l-2.3 1.8-1.2-1.8L12 13z"
          />
        </svg>
      ),
    },
  ];

  return (
    <main className="relative overflow-hidden min-h-screen pb-16 lg:pb-0 home-candy text-[var(--text)]">
      <section
        className="home-product-stage bg-[#FFF8F2]"
        data-zone="HERO"
        style={{ backgroundImage: "none" }}
      >
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 lg:py-10">
          <div className="relative grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div className="order-2 relative lg:order-1">
              <div className="relative z-10 space-y-3">
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-[var(--navy)] sm:text-5xl lg:text-6xl">
                  All-American Gummy Bears
                </h1>
                <p className="text-base text-[var(--text)] sm:text-lg">
                  Soft, chewy, classic gummy bears — made in the USA.
                </p>
                <div className="text-sm font-semibold text-[var(--navy)]">
                  No artificial dyes • All natural flavors
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--navy)]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navy)] text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M3 11l9-6 9 6v9H3v-9zm4 0h10v7H7v-7z"
                        />
                      </svg>
                    </span>
                    Made in the USA
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--navy)]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navy)] text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 3c4 3 6 6.3 6 9.6A6 6 0 0 1 6 12.6C6 9.3 8 6 12 3z"
                        />
                      </svg>
                    </span>
                    No artificial dyes
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--navy)]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navy)] text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 4c4.4 0 8 3.6 8 8s-3.6 8-8 8-8-3.6-8-8 3.6-8 8-8z"
                        />
                      </svg>
                    </span>
                    All natural flavors
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--navy)]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navy)] text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 21s-6.7-4.1-8.6-7.5C2.2 10.6 4.3 7 7.8 7c2 0 3.3 1 4.2 2.3C12.9 8 14.2 7 16.2 7c3.5 0 5.6 3.6 4.4 6.5C18.7 16.9 12 21 12 21z"
                        />
                      </svg>
                    </span>
                    Loved by American families
                  </div>
                </div>
                <div className="pt-1 space-y-2">
                  <div className="text-xs font-semibold text-[var(--muted)]">
                    Save more per bag when you add 4+ bags.
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <a
                      href="#bundle-pricing"
                      className="btn btn-candy w-full sm:w-auto"
                      style={{ padding: "14px 22px", boxShadow: "0 16px 34px rgba(239, 59, 59, 0.34)" }}
                    >
                      <span className="text-[15px] sm:text-[16px] font-semibold">Shop now and save</span>
                    </a>
                    <div className="text-xs font-semibold text-[var(--muted)]">Love it or your money back</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
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
            </div>

            <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
              <div className="relative w-full max-w-[420px] sm:max-w-[520px] lg:max-w-[640px]">
                <div className="relative aspect-[4/5] overflow-visible">
                  <Image
                    src={heroMediaSrc}
                    alt="USA Gummies bag"
                    fill
                    priority
                    fetchPriority="high"
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 55vw, 640px"
                    className="object-contain drop-shadow-[0_26px_40px_rgba(13,28,51,0.28)] z-10"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#fffdf8]" data-zone="VALUE" aria-label="Product value">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:py-5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--navy)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M3 10.2 12 5l9 5.2v8.3H3v-8.3zm9-2.9-6.2 3.6h12.4L12 7.3z"
                    />
                  </svg>
                </div>
                <div className="text-[13px] font-black text-[var(--text)]">Made in the USA</div>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Proudly sourced, manufactured, and packed in America.
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--navy)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 3c4 3 6 6.3 6 9.6A6 6 0 0 1 6 12.6C6 9.3 8 6 12 3z"
                    />
                  </svg>
                </div>
                <div className="text-[13px] font-black text-[var(--text)]">No artificial dyes</div>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                Colored naturally using real fruit and vegetable extracts.
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--navy)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M4 6h16v3H4V6zm0 5h16v7H4v-7z"
                    />
                  </svg>
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

      <section className="bg-[#fffdf8]" data-zone="FLAVORS">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]/80">
            Inside every bag
          </div>
          <div className="mt-1.5 text-sm font-semibold text-[var(--text)]">
            Five classic gummy bear flavors.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
            <span className="candy-pill">
              <span className="candy-dot bg-[var(--candy-red)]" />
              Cherry
            </span>
            <span className="candy-pill">
              <span className="candy-dot bg-[var(--candy-yellow)]" />
              Lemon
            </span>
            <span className="candy-pill">
              <span className="candy-dot bg-[var(--candy-green)]" />
              Green apple
            </span>
            <span className="candy-pill">
              <span className="candy-dot bg-[var(--candy-orange)]" />
              Orange
            </span>
            <span className="candy-pill">
              <span className="candy-dot bg-[var(--candy-red)]" />
              Watermelon
            </span>
            <span className="text-[11px] text-[var(--muted)]">
              Ingredients &amp; allergen info:{" "}
              <Link href="/ingredients" className="underline underline-offset-4 text-[var(--text)]">
                ingredients
              </Link>
              .
            </span>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneBundle}`} data-zone="BUNDLE">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 pb-5 sm:pb-6 lg:pb-8">
            <div className="mt-2">
              <div id="hero-primary-cta" className="atomic-buy">
                <div className="atomic-buy__glow" aria-hidden="true" />
                <div className="atomic-buy__header">
                  <div className="atomic-buy__headerMain">
                    <div className="atomic-buy__kicker">USA Gummies</div>
                    <div className="atomic-buy__headerTitle">
                      Classic gummy bears, made in the USA.
                    </div>
                  </div>
                  <div className="atomic-buy__headerSub">
                    Add more bags and watch your per-bag price drop. Savings apply to your total bag count.
                  </div>
                </div>
                <div className="atomic-buy__grid">
                  <div className="atomic-buy__product">
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
                        <span className="atomic-buy__chip">Ships in 24 hours</span>
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
                            alt="USA Gummies bag"
                            fill
                            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 520px"
                            className="object-contain drop-shadow-[0_24px_50px_rgba(13,28,51,0.2)]"
                          />
                        </div>
                        <span className="usa-stamp usa-stamp--small atomic-buy__stamp">
                          Made in USA
                        </span>
                      </div>
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
                      showHowItWorks={false}
                      summaryCopy=""
                      showTrainAccent={false}
                      showAccent={true}
                      showEducation={false}
                      ctaVariant="simple"
                      primaryCtaLabel="Shop & save"
                      featuredQuantities={[5, 8, 12]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneReviews}`} data-zone="REVIEWS">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 py-5 lg:py-6 reveal-up">
            <ReviewsSection />
          </div>
        </div>
      </section>

      <section className="bg-[#fffdf8]" data-zone="SHIPPING">
        <div className="mx-auto max-w-6xl px-4 pb-6">
          <div className="grid gap-3 rounded-[28px] border border-[rgba(15,27,45,0.12)] bg-white p-4 sm:p-5 lg:grid-cols-[1fr_200px] lg:items-center">
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Shipping &amp; fulfillment
              </div>
              <div className="text-[15px] font-black text-[var(--text)] sm:text-base">
                Ships within 24 hours, every order packed with care.
              </div>
              <div className="text-sm font-semibold text-[var(--text)]">
                Love it or your money back.
              </div>
            </div>
            <div className="justify-self-end">
              <Image
                src="/website%20assets/Truck.png"
                alt=""
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
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 reveal-up">
          <div className="candy-panel relative overflow-hidden rounded-[36px] p-5 sm:p-6">
            <div className="relative z-10">
              <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                <div className="space-y-3">
                  <div className="flex justify-center lg:justify-start">
                    <Image
                      src="/website%20assets/MtRushmore.png"
                      alt=""
                      aria-hidden="true"
                      width={1398}
                      height={857}
                      sizes="(max-width: 640px) 200px, (max-width: 1024px) 260px, 320px"
                      className="brand-touch h-auto w-full max-w-[200px] sm:max-w-[240px] lg:max-w-[320px] object-contain"
                    />
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                    Why USA Gummies
                  </div>
                  <h2 className="text-3xl font-black text-[var(--text)] sm:text-4xl">
                    Why USA Gummies matters.
                  </h2>
                  <p className="text-sm text-[var(--muted)] sm:text-base">
                    Proudly sourced, manufactured, and packed entirely in America. No artificial
                    dyes or synthetic colors. Classic gummy bear flavor — done right.
                  </p>
                  <div className="candy-panel rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--muted)]">
                      Our story
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                      Purchasing these gummies is a vote in the America you believe in.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <a href="#bundle-pricing" className="btn btn-candy">
                      Shop now and save
                    </a>
                    <Link
                      href="/shop#product-details"
                      className="text-xs font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] focus-ring"
                    >
                      View product details
                    </Link>
                  </div>
                </div>

                <div className="space-y-3 lg:pt-2">
                  <div className="candy-panel relative overflow-hidden rounded-3xl p-2 text-[var(--text)] lg:ml-auto lg:max-w-[440px]">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white">
                      <Image
                        src={whyImageSrc}
                      alt={whyImageAlt}
                      fill
                      sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 420px"
                      className="object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 via-black/0 to-transparent p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/90">
                        Made in USA
                      </div>
                    </div>
                  </div>
                    <div className="mt-2 space-y-2">
                      <div className="text-base font-black text-[var(--text)]">
                        Classic gummy bear flavor — done right.
                      </div>
                    <div className="text-xs text-[var(--muted)]">
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
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="flex items-end justify-start">
              <Image
                src="/website%20assets/Jeep.png"
                alt=""
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
                  className="candy-panel relative overflow-hidden rounded-2xl p-3 transition-transform duration-200 hover:-translate-y-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-strong)]">
                      {card.icon}
                    </div>
                    <div className="text-base font-black text-[var(--text)]">{card.title}</div>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">{card.copy}</p>
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
          <div className="mx-auto max-w-6xl px-4 py-6 lg:py-8 reveal-up">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="candy-panel rounded-[28px] p-4 sm:p-5 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                      Follow the fun
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

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-2">
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

                <div className="mt-4 text-xs text-[var(--muted)]">
                  Tap any channel to follow and stay in the loop.
                </div>
              </div>
              <div className="candy-panel relative overflow-hidden rounded-[28px] p-4 sm:p-5 shadow-none bg-[var(--surface-strong)] border border-[rgba(15,27,45,0.12)]">
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                    Get updates
                  </div>
                  <h3 className="text-xl font-black text-[var(--text)] sm:text-2xl">Unlock early access + member-only drops</h3>
                  <p className="text-sm text-[var(--muted)]">
                    First dibs on limited drops, restocks, and member-only savings alerts.
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)] w-fit">
                    VIP early access • limited-batch alerts
                  </div>
                  <form className="flex flex-wrap gap-3 items-center rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-1.5 sm:p-2">
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

      <section className="bg-[#fffdf8]" data-zone="STORY">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Our story
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)] sm:text-3xl">
              {BRAND_STORY_HEADLINE}
            </h2>
            <div className="mt-4 space-y-3 text-sm text-[var(--muted)]">
              {BRAND_STORY_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/about" className="btn btn-outline">
                Read our story
              </Link>
              <Link href="/shop" className="btn btn-candy">
                Shop now and save
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.scene} ${styles.sceneFooter}`} aria-hidden="true">
        <div className={styles.sceneBg} aria-hidden="true" />
        <div className={styles.sceneOverlay} aria-hidden="true" />
        <div className={styles.sceneContent}>
          <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
            <div className="h-10 sm:h-12 lg:h-16" />
          </div>
        </div>
      </section>

      <div className="sticky-cta-bar fixed bottom-4 left-1/2 z-40 hidden w-[min(94vw,680px)] -translate-x-1/2 translate-y-4 bg-transparent opacity-0 transition-all duration-300">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[rgba(15,27,45,0.12)] bg-white/90 px-4 py-3 shadow-[0_18px_44px_rgba(15,27,45,0.12)] backdrop-blur-md">
          <div className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)] sm:block">
            Save more with more bags
          </div>
          <a href="#bundle-pricing" className="btn btn-candy w-full sm:w-auto">
            Shop now and save
          </a>
        </div>
      </div>

      <HeroCTAWatcher />
    </main>
  );
}
