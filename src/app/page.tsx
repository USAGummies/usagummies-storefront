import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";
import { getProductByHandle } from "@/lib/storefront";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import ReviewsSection from "@/components/home/ReviewsSection";
import { InstagramGrid } from "@/components/instagram/InstagramGrid.client";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { FREE_SHIPPING_PHRASE, pricingForQty } from "@/lib/bundles/pricing";
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

  const heroMediaSrc = "/hero-loop.gif";
  const starterPricing = pricingForQty(1);
  const bestValuePricing = pricingForQty(8);
  const starterPerBag = formatMoney(starterPricing.perBag);
  const bestValuePerBag = formatMoney(bestValuePricing.perBag);
  const bestValueSavingsPct =
    starterPricing.perBag > 0
      ? Math.max(
          0,
          Math.round(
            ((starterPricing.perBag - bestValuePricing.perBag) / starterPricing.perBag) * 100
          )
        )
      : 0;
  const bestValueLine =
    bestValueSavingsPct > 0
      ? `~${bestValuePerBag} / bag • save ${bestValueSavingsPct}%`
      : `~${bestValuePerBag} / bag`;
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
  const storySteps = [
    {
      title: "Pick your bundle",
      copy: `${FREE_SHIPPING_PHRASE}. 8 bags is the sweet spot.`,
    },
    {
      title: "Choose your flavors",
      copy: "Mix and match your favorites for a bundle that feels custom.",
    },
    {
      title: "Checkout fast",
      copy: "Add once, ship fast, and stock up without the chaos.",
    },
  ];

  return (
    <main
      className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen pb-16 lg:pb-0"
      style={{ backgroundColor: "var(--bg, #f8f5ef)", color: "var(--text, #1c2430)" }}
    >
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
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:py-12 lg:py-16">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">American-made gummies</span>
                <span className="text-[var(--gold)]">Fan-favorite</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl font-black leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Dye-Free Gummy Bears — Made in the USA.
                </h1>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  All-natural flavors. No artificial dyes. Build a bundle to save more —{" "}
                  {FREE_SHIPPING_PHRASE}.
                </p>
                <div className="text-sm font-semibold text-white/75">
                  Bundle &amp; save • 8+ bags is the sweet spot
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Best value</div>
                  <div className="mt-1 text-lg font-black text-white">8 bags</div>
                  <div className="text-xs text-white/70">{bestValueLine}</div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Free shipping</div>
                  <div className="mt-1 text-lg font-black text-white">5+ bags</div>
                  <div className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Made in USA</div>
                  <div className="mt-1 text-lg font-black text-white">Dye-free</div>
                  <div className="text-xs text-white/70">All natural flavors</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div id="hero-primary-cta" className="w-full sm:w-auto">
                  <a href="#bundle-pricing" className="btn btn-red w-full sm:w-auto">
                    Build my bundle
                  </a>
                </div>
                <Link href="/shop" className="btn btn-outline-white w-full sm:w-auto">
                  Shop flavors
                </Link>
                <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
              </div>

              <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 flex flex-wrap items-center gap-4">
                <span className="text-sm font-semibold text-white">★★★★★ Verified buyer reviews</span>
                <span className="text-xs text-white/70">Real customers. Real bundles.</span>
              </div>

              <Link
                href={`/products/${handle}`}
                className="text-xs sm:text-sm text-white/70 underline underline-offset-4 hover:text-white focus-ring w-fit inline-flex"
              >
                See ingredients & single bag →
              </Link>
            </div>

            <div className="relative space-y-4">
              <div className="relative">
                <div className="absolute -top-6 right-6 h-20 w-20 rounded-full bg-[rgba(199,54,44,0.25)] blur-2xl" aria-hidden="true" />
                <div className="relative rounded-3xl border border-white/20 bg-white/95 p-3 text-[var(--navy)] shadow-[0_30px_70px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                    <Image
                      src={heroMediaSrc}
                      alt="USA Gummies hero"
                      fill
                      priority
                      unoptimized
                      sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 520px"
                      className="object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/80">
                        Best seller
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Best seller
                    </div>
                    <div className="text-lg font-black text-[var(--navy)]">
                      {title}
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      From {starterPerBag} / bag • {FREE_SHIPPING_PHRASE}
                    </div>
                    {bestValueSavingsPct > 0 ? (
                      <div className="mt-2 inline-flex items-center rounded-full bg-[var(--navy)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--navy)]">
                        Save {bestValueSavingsPct}% with 8-bag bundles
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">Dye-free</span>
                    </div>
                  </div>
                </div>
              </div>

              <BundleQuickBuy
                anchorId="bundle-pricing"
                productHandle={handle}
                tiers={homepageTiers}
                singleBagVariantId={bundleVariants?.singleBagVariantId}
                availableForSale={bundleVariants?.availableForSale}
                variant="compact"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[var(--navy)] text-white">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 10%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 90% 0%, rgba(255,255,255,0.05), transparent 38%)",
            opacity: 0.3,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-7 lg:py-10 reveal-up">
          <ReviewsSection />
        </div>
      </section>

      <section className="bg-[var(--bg)]">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:py-10 reveal-up">
          <div className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_20px_54px_rgba(15,27,45,0.12)] sm:p-8">
            <div className="relative space-y-6">
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h2 className="text-3xl font-black text-[var(--text)] sm:text-4xl">
                      Why USA Gummies matters.
                    </h2>
                    <p className="text-base text-[var(--muted)] sm:text-lg">
                      We’re building the clean, American-made gummy bear you can feel proud to
                      share. No artificial dyes. No gimmicks. Just bold flavor, crafted in the USA,
                      with bundle pricing that rewards the big move.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {storySteps.map((step, idx) => (
                      <div
                        key={step.title}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 shadow-[0_12px_30px_rgba(15,27,45,0.08)]"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                          Step {idx + 1}
                        </div>
                        <div className="mt-1 text-sm font-black text-[var(--text)]">{step.title}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">{step.copy}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <a href="#bundle-pricing" className="btn btn-red">
                      Build my bundle
                    </a>
                    <Link href="/shop" className="btn btn-navy">
                      Shop flavors
                    </Link>
                    <span className="text-xs font-semibold text-[var(--muted)]">
                      {FREE_SHIPPING_PHRASE}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-[0_18px_44px_rgba(15,27,45,0.16)]">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/60 bg-white">
                      <Image
                        src="/home-patriotic-product.jpg"
                        alt="USA Gummies patriotic bundle"
                        fill
                        sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 420px"
                        className="object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/80">
                          Made in USA
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="text-base font-black text-[var(--text)]">
                        Clean ingredients. Bold flavor. Built for bundles.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="badge badge--navy">Dye-free</span>
                        <span className="badge badge--navy">All natural flavors</span>
                        <span className="badge badge--navy">{FREE_SHIPPING_PHRASE}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
                    American-made gummies with clean ingredients and honest bundle savings.
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {whyCards.map((card) => (
                  <div
                    key={card.title}
                    className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-[0_14px_32px_rgba(15,27,45,0.12)] transition-transform duration-200 hover:-translate-y-1"
                  >
                    <div className="flex items-center gap-3">
                      <div className="icon-float flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(13,28,51,0.06)]">
                        {card.icon}
                      </div>
                      <div className="text-lg font-black text-[var(--text)]">{card.title}</div>
                    </div>
                    <p className="mt-3 text-sm text-[var(--muted)]">{card.copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--bg)]">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 reveal-up">
          <InstagramGrid username="usagummies" limit={12} />
        </div>
      </section>

      <section className="bg-[var(--bg)]">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:py-8 reveal-up">
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_rgba(15,27,45,0.12)]">
            <div className="relative space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Get updates
              </div>
              <h3 className="text-2xl font-black text-[var(--text)]">Unlock early access + bundle-only drops</h3>
              <p className="text-sm text-[var(--muted)]">
                First dibs on limited flavors, restocks, and member-only bundle alerts.
              </p>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold text-[var(--text)] w-fit">
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
          </div>
        </div>
      </section>

      <HeroCTAWatcher />
    </main>
  );
}
