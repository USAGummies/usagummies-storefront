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

export const metadata: Metadata = {
  title: "USA Gummies | American-Made Clean Gummies",
  description:
    "Premium American-made gummy bears with clean ingredients and no dyes. Free shipping on 5+ bags.",
};

function formatMoney(amount: string | number, currency = "USD") {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `$${amount}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

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

  const title =
    detailedProduct?.title?.toString?.() ||
    product?.title?.toString?.() ||
    "All American Gummy Bears – 7.5 oz bag";

  const description =
    detailedProduct?.description?.toString?.() ||
    product?.description?.toString?.() ||
    "All natural flavors. Free from artificial dyes. Built in America. Shipped fast.";

  const heroMediaSrc = "/hero-loop.gif";
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const homepageTiers = (bundleVariants?.variants || []).filter((t) =>
    [1, 2, 3, 4, 5, 8, 12].includes(t.quantity)
  );

  const whyCards = [
    {
      title: "American-made craft",
      copy: "Built in the USA with clean ingredients and tight quality control.",
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--gold)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 10.2 12 5l9 5.2v8.3H3v-8.3zm9-2.9-6.2 3.6h12.4L12 7.3zM7 12h2v5H7v-5zm4 0h2v5h-2v-5zm4 0h2v5h-2v-5z"
          />
        </svg>
      ),
    },
    {
      title: "Clean, dye-free",
      copy: "All-natural flavors with no artificial dyes or neon aftertaste.",
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--gold)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3c4 3 6 6.3 6 9.6A6 6 0 0 1 6 12.6C6 9.3 8 6 12 3zm0 3.2C9.4 8.2 8 10.2 8 12.6a4 4 0 1 0 8 0c0-2.4-1.4-4.4-4-6.4z"
          />
        </svg>
      ),
    },
    {
      title: "Bundle value",
      copy: `Save more as you add bags. ${FREE_SHIPPING_PHRASE}.`,
      icon: (
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-[var(--gold)]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h16v3H4V6zm0 5h16v7H4v-7zm5-4h6v-1H9v1zm3 6 3.5 2-1.2 1.8L12 15l-2.3 1.8-1.2-1.8L12 13z"
          />
        </svg>
      ),
    },
  ];

  return (
    <main
      className="bg-[var(--bg)] text-[var(--text)] min-h-screen pb-16 lg:pb-0"
      style={{ backgroundColor: "var(--bg, #0c1426)", color: "var(--text, #f2f6ff)" }}
    >
      <section
        className="relative overflow-hidden border-b border-gold-soft hero-parallax"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.02) 100%), radial-gradient(circle at 10% 20%, rgba(255,255,255,0.05), rgba(255,255,255,0) 35%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.05), rgba(255,255,255,0) 30%)",
        }}
      >
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 py-3 sm:py-5 lg:py-9">
          <div className="grid gap-4 lg:gap-9 lg:grid-cols-2 lg:items-stretch">
            <div className="flex flex-col gap-2.5">
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                American-made gummies
              </div>
              <div className="space-y-1.5">
                <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
                  Dye-Free Gummy Bears — Made in the USA.
                </h1>
                <div className="text-[13px] font-semibold uppercase tracking-[0.22em] text-[var(--gold)]">
                  Fan-favorite
                </div>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  All-natural flavors. No artificial dyes. Build a bundle to save more —{" "}
                  {FREE_SHIPPING_PHRASE}.
                </p>
                {/* Mobile pills: exactly two, never wrap */}
                <div className="flex md:hidden flex-nowrap items-center gap-2 overflow-hidden text-[11px] font-semibold text-white/75 hero-badge-fade">
                  <span className="badge px-2 py-1 opacity-80">🇺🇸 Made in USA</span>
                  <span className="badge px-2 py-1 opacity-80">✅ Dye-free</span>
                </div>
                {/* Desktop/tablet pills: three pills */}
                <div className="hidden md:flex flex-nowrap items-center gap-2 overflow-hidden text-xs font-semibold text-white/80 hero-badge-fade">
                  <span className="badge px-3 py-1.5">🇺🇸 Made in USA</span>
                  <span className="badge px-3 py-1.5">✅ Dye-free</span>
                  <span className="badge px-3 py-1.5">🚚 Ships fast</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-sm font-semibold text-[var(--muted)]">
                  <span>Bundle & save</span>
                  <span className="text-[var(--muted)]">•</span>
                  <span>8+ bags is the sweet spot</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <div className="text-sm text-amber-200 font-semibold">
                  ★★★★★ Verified buyer rating
                </div>
                <div id="hero-primary-cta" className="w-full sm:w-auto">
                  <a href="#bundle-pricing" className="btn btn-red w-full sm:w-auto">
                    Build my bundle
                  </a>
                </div>
                <div className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/75">
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                    100% Satisfaction Guarantee
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                    50,000+ bags shipped nationwide
                  </span>
                </div>
              </div>
              <div className="lg:hidden">
                <div className="usa-hero__frame h-full min-h-[130px] sm:min-h-[180px] rounded-2xl border border-gold-soft">
                  <Image
                    src={heroMediaSrc}
                    alt="USA Gummies hero"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 560px"
                    className="object-cover hero-media__img"
                  />
                  <div className="hero-fade" />
                </div>
                {/* hide link on mobile to avoid overlap */}
                <div className="mt-2">
                  <Link
                    href="/products/all-american-gummy-bears-7-5-oz-single-bag"
                    className="hidden lg:inline-flex text-xs sm:text-sm text-white/65 underline underline-offset-4 hover:text-white focus-ring w-fit"
                  >
                    See ingredients & single bag →
                  </Link>
                </div>
              </div>
              <div className="hidden lg:block">
                <Link
                  href="/products/all-american-gummy-bears-7-5-oz-single-bag"
                  className="text-xs sm:text-sm text-white/65 underline underline-offset-4 hover:text-white focus-ring w-fit inline-flex"
                >
                  See ingredients & single bag →
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:gap-5">
              <div className="relative hidden lg:block">
                <div className="usa-hero__frame h-full min-h-[230px] lg:min-h-[360px] rounded-2xl border border-gold-soft">
                  <Image
                    src={heroMediaSrc}
                    alt="USA Gummies hero"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 560px"
                    className="object-cover hero-media__img"
                  />
                  <div className="hero-fade" />
                </div>
              </div>

              <BundleQuickBuy
                anchorId="bundle-pricing"
                productHandle={handle}
                tiers={homepageTiers}
                singleBagVariantId={bundleVariants?.singleBagVariantId}
                availableForSale={bundleVariants?.availableForSale}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 reveal-up">
          <ReviewsSection />
        </div>
      </section>

      <section className="border-t border-gold-soft bg-[rgba(255,255,255,0.02)]">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-4 reveal-up">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-[var(--text)]">Why USA Gummies</h2>
            <div className="text-sm font-semibold text-[var(--muted)]">
              American-made, clean, and built for bundles.
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {whyCards.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.22)] transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex items-center gap-3">
                  <div className="icon-float">{card.icon}</div>
                  <div className="text-lg font-black text-white">{card.title}</div>
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">{card.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-3 reveal-up">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Join the movement
              </div>
              <h3 className="mt-1 text-xl font-black text-[var(--text)]">
                Follow @usagummies for new flavors & customer stories
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Real customers. Real bundles. Built in America.
              </p>
            </div>
            <Link
              href="https://www.instagram.com/usagummies"
              className="btn btn-navy"
            >
              Follow @usagummies
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft bg-[rgba(255,255,255,0.02)]">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-3 reveal-up">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            Get updates
          </div>
          <h3 className="text-2xl font-black text-white">Unlock early access + bundle-only drops</h3>
          <p className="text-sm text-white/70">
            First dibs on limited flavors, restocks, and member-only bundle alerts.
          </p>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80 w-fit">
            VIP early access • limited-batch alerts
          </div>
          <form className="flex flex-wrap gap-3 items-center">
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              className="usa-input flex-1 min-w-[240px]"
              aria-label="Enter your email for updates"
              required
            />
            <button type="submit" className="btn btn-red pressable px-5 py-3 font-black w-full sm:w-auto">
              Sign me up
            </button>
          </form>
        </div>
      </section>

      <HeroCTAWatcher />
    </main>
  );
}
