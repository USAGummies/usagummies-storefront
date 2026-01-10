import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import ReviewsSection from "@/components/home/ReviewsSection";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import HeroCTAWatcher from "@/components/home/HeroCTAWatcher";

export const metadata: Metadata = {
  title: "USA Gummies | American-Made Clean Gummies",
  description:
    "Premium American-made gummy bears with clean ingredients, no dyes, and free shipping at 5+ bags.",
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

  const heroImg = "/brand/hero.jpg";
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const homepageTiers = (bundleVariants?.variants || []).filter((t) =>
    [5, 8, 12].includes(t.quantity)
  );

  return (
    <main
      className="bg-[var(--bg)] text-[var(--text)] min-h-screen pb-16 lg:pb-0"
      style={{ backgroundColor: "var(--bg, #0c1426)", color: "var(--text, #f2f6ff)" }}
    >
      <section
        className="relative overflow-hidden border-b border-gold-soft"
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
                  Bold Flavor. Clean Label. Gummy Bears Done Right.
                </h1>
                <div className="text-[13px] font-semibold uppercase tracking-[0.22em] text-[var(--gold)]">
                  Fan-favorite
                </div>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Dye-free, all-natural gummies — free shipping on 5+ bags.
                </p>
                {/* Mobile pills: exactly two, never wrap */}
                <div className="flex md:hidden flex-nowrap items-center gap-2 overflow-hidden text-[11px] font-semibold text-white/75">
                  <span className="badge px-2 py-1 opacity-80">🇺🇸 Made in USA</span>
                  <span className="badge px-2 py-1 opacity-80">✅ Dye-free</span>
                </div>
                {/* Desktop/tablet pills: three pills */}
                <div className="hidden md:flex flex-nowrap items-center gap-2 overflow-hidden text-xs font-semibold text-white/80">
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
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap">
                <div className="text-sm text-white/80 font-semibold">
                  <span className="text-[var(--gold)]">★★★★★</span> 4.9 stars • Real reviews
                </div>
                <div id="hero-primary-cta" className="w-full sm:w-auto">
                  <a href="#bundle-pricing" className="btn btn-red w-full sm:w-auto">
                    Build my bundle
                  </a>
                </div>
              </div>
              <div className="lg:hidden">
                <div className="usa-hero__frame h-full min-h-[130px] sm:min-h-[180px] rounded-2xl border border-gold-soft">
                  <Image
                    src={heroImg}
                    alt="USA Gummies hero"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 560px"
                    className="object-cover"
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
                    src={heroImg}
                    alt="USA Gummies hero"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 560px"
                    className="object-cover"
                  />
                  <div className="hero-fade" />
                </div>
              </div>

              <BundleQuickBuy
                anchorId="bundle-pricing"
                productHandle={handle}
                tiers={homepageTiers}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8">
          <ReviewsSection />
        </div>
      </section>

      <section className="border-t border-gold-soft bg-[rgba(255,255,255,0.02)]">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-[var(--text)]">Why USA Gummies</h2>
            <div className="text-sm font-semibold text-[var(--muted)]">
              American-made. Clean ingredients. Bundle-first value.
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "American-made",
                bullets: ["Built in the USA", "Fast shipping", "Founder-led"],
              },
              {
                title: "Clean, dye-free",
                bullets: ["No artificial dyes", "All-natural ingredients", "Soft, bold flavor"],
              },
              {
                title: "Bundle value",
                bullets: ["Free ship 5+", "Best per-bag at 8+", "Easy, secure checkout"],
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.22)]"
              >
                <div className="text-lg font-black text-white">{card.title}</div>
                <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                  {card.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <span className="mt-[6px] h-[6px] w-[6px] rounded-full bg-[var(--gold)]" aria-hidden="true" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Join the movement
              </div>
              <h3 className="mt-1 text-xl font-black text-[var(--text)]">
                Follow @usagummies for drops & hauls
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
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            Get updates
          </div>
          <h3 className="text-2xl font-black text-white">Don’t miss the next drop</h3>
          <p className="text-sm text-white/70">
            Bundles sell out. Early access + deals via email.
          </p>
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
