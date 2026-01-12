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
import { AMAZON_LISTING_URL } from "@/lib/amazon";

export const metadata: Metadata = {
  title: "USA Gummies | All American Gummy Bears",
  description:
    "USA Gummies - All American Gummy Bears, made in the USA with no artificial dyes or synthetic colors and all natural flavors.",
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
    "All American Gummy Bears - 7.5 oz bag";

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
    [5, 8, 12].includes(t.quantity)
  );

  const whyCards = [
    {
      title: "Made in the USA",
      copy: "Proudly sourced, manufactured, and packed entirely in America.",
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
      title: "No artificial dyes",
      copy: "Colored naturally using real fruit and vegetable extracts.",
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
      title: "Classic gummy bear flavor",
      copy: "Chewy, fruity flavor without artificial ingredients or harsh aftertaste.",
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
  const checkoutSteps = [
    {
      title: "Pick your bundle",
      copy: `Choose 5, 8, or 12 bags. ${FREE_SHIPPING_PHRASE}.`,
    },
    {
      title: "Classic gummy bear flavor — done right",
      copy: "All natural flavors. No artificial dyes or synthetic colors.",
    },
    {
      title: "Made in the USA",
      copy: "Proudly sourced, manufactured, and packed entirely in America.",
    },
  ];

  return (
    <main
      className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen pb-16 lg:pb-0 home-metal"
      style={{ backgroundColor: "var(--navy, #0d1c33)", color: "#ffffff" }}
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
        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:py-10 lg:py-12">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-white/25 bg-white/95 p-1 shadow-[0_16px_36px_rgba(7,12,20,0.35)]">
                  <Image
                    src="/home-patriotic-product.jpg"
                    alt="USA Gummies bag"
                    fill
                    sizes="64px"
                    className="rounded-xl object-cover"
                  />
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/60">
                  Best seller
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70 sm:text-xs">
                <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1">Made in the USA</span>
                <span className="text-[var(--gold)]">No artificial dyes</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  USA Gummies — All American Gummy Bears.
                </h1>
                <div className="font-script text-[var(--gold)] text-2xl sm:text-3xl">
                  Made in the U.S.A.
                </div>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  No artificial dyes or synthetic colors. All natural flavors. Classic gummy bear
                  flavor — done right.
                </p>
                <div className="text-xs text-white/65">
                  7.5 oz bag with 5 fruit flavors: cherry, watermelon, orange, green apple, lemon.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div id="hero-primary-cta" className="w-full sm:w-auto">
                  <a href="#bundle-pricing" className="btn btn-red w-full sm:w-auto">
                    Build my bundle
                  </a>
                </div>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white w-full sm:w-auto"
                >
                  Buy 1-3 bags on Amazon
                </a>
                <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {checkoutSteps.map((step, idx) => (
                  <div
                    key={step.title}
                    className="rounded-2xl border border-white/10 bg-white/5 p-3"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/50">
                      Step {idx + 1}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">{step.title}</div>
                    <div className="mt-1 text-xs text-white/65">{step.copy}</div>
                  </div>
                ))}
              </div>

              <div className="metal-panel rounded-3xl border border-white/12 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Best value</div>
                    <div className="text-base font-black text-white">8 bags</div>
                    <div className="text-[11px] text-white/70">{bestValueLine}</div>
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

              <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
                <span className="font-semibold text-white">★★★★★ Verified buyer reviews</span>
                <span>Also available on Amazon</span>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white/70 underline underline-offset-4 hover:text-white focus-ring"
                >
                  View Amazon listing →
                </a>
              </div>

              <div className="metal-panel rounded-3xl border border-white/12 p-4">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  <span>Inside every bag</span>
                  <span className="text-[11px] tracking-[0.2em] text-white/50">7.5 oz</span>
                </div>
                <div className="mt-2 grid gap-2 text-sm text-white/80">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                    <span>All natural flavors. No artificial dyes or synthetic colors.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-[rgba(199,54,44,0.8)]" />
                    <span>Classic gummy bear flavor — done right.</span>
                  </div>
                  <div className="flex items-start gap-2 text-white/70">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-white/50" />
                    <span>5 fruit flavors: cherry, watermelon, orange, green apple, lemon.</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="badge badge--navy">Made in USA</span>
                  <span className="badge badge--navy">No artificial dyes</span>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.45)] p-3 ring-1 ring-white/20 shadow-[0_32px_90px_rgba(7,12,20,0.6)]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  <span>Build your bundle</span>
                  <span className="text-[var(--gold)]">5 / 8 / 12 bags</span>
                </div>
                <div className="mt-1 text-xs text-white/70">
                  Tap a bundle size to lock your price.
                </div>
                <div className="mt-3 space-y-3">
                  <div className="bundle-home metal-panel rounded-[28px] border border-[rgba(199,160,98,0.4)] p-2 shadow-[0_22px_60px_rgba(7,12,20,0.6)]">
                    <BundleQuickBuy
                      anchorId="bundle-pricing"
                      productHandle={handle}
                      tiers={homepageTiers}
                      singleBagVariantId={bundleVariants?.singleBagVariantId}
                      availableForSale={bundleVariants?.availableForSale}
                      variant="compact"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute -top-6 right-6 h-20 w-20 rounded-full bg-[rgba(199,54,44,0.25)] blur-2xl" aria-hidden="true" />
                    <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_30px_70px_rgba(7,12,20,0.35)]">
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
                      <div className="mt-2 space-y-1">
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
                          <div className="mt-1 inline-flex items-center rounded-full bg-[var(--navy)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--navy)]">
                            Save {bestValueSavingsPct}% with 8-bag bundles
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span className="badge badge--navy">Made in USA</span>
                          <span className="badge badge--navy">No artificial dyes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
        <div className="relative mx-auto max-w-6xl px-4 py-6 lg:py-8 reveal-up">
          <ReviewsSection />
        </div>
      </section>

      <section className="bg-[var(--navy)]">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 reveal-up">
          <div className="metal-panel relative overflow-hidden rounded-[36px] border border-[rgba(199,54,44,0.25)] p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  Why USA Gummies
                </div>
                <h2 className="text-3xl font-black text-white sm:text-4xl">
                  Why USA Gummies matters.
                </h2>
                <p className="text-sm text-white/75 sm:text-base">
                  Proudly sourced, manufactured, and packed entirely in America. No artificial
                  dyes or synthetic colors. Classic gummy bear flavor — done right.
                </p>
                <p className="text-xs text-white/65">
                  7.5 oz bag with 5 fruit flavors: cherry, watermelon, orange, green apple, lemon.
                </p>
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
                  <Link
                    href={`/products/${handle}`}
                    className="text-xs font-semibold text-white/70 underline underline-offset-4 hover:text-white focus-ring"
                  >
                    View product details →
                  </Link>
                </div>
              </div>

              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_22px_60px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/60 bg-white">
                    <Image
                      src="/home-patriotic-product.jpg"
                      alt="USA Gummies bundle"
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
                  <div className="mt-2 space-y-2">
                    <div className="text-base font-black text-[var(--navy)]">
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

            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {whyCards.map((card) => (
                <div
                  key={card.title}
                  className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[0_18px_42px_rgba(7,12,20,0.35)] transition-transform duration-200 hover:-translate-y-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
                      {card.icon}
                    </div>
                    <div className="text-base font-black text-white">{card.title}</div>
                  </div>
                  <p className="mt-3 text-sm text-white/70">{card.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--navy)]">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 reveal-up">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <InstagramGrid username="usagummies" limit={8} />
            <div className="metal-panel relative overflow-hidden rounded-[32px] border border-[rgba(199,54,44,0.3)] p-5 text-white">
              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  Get updates
                </div>
                <h3 className="text-2xl font-black text-white">Unlock early access + bundle-only drops</h3>
                <p className="text-sm text-white/70">
                  First dibs on limited drops, restocks, and member-only bundle alerts.
                </p>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80 w-fit">
                  VIP early access • limited-batch alerts
                </div>
                <form className="flex flex-wrap gap-3 items-center rounded-2xl border border-white/10 bg-white/5 p-2">
                  <input
                    type="email"
                    name="email"
                    placeholder="Enter your email"
                    className="flex-1 min-w-[220px] rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[rgba(199,160,98,0.45)]"
                    aria-label="Enter your email for updates"
                    required
                  />
                  <button type="submit" className="btn btn-red pressable px-5 py-3 font-black w-full sm:w-auto">
                    Sign me up
                  </button>
                </form>
                <div className="text-[11px] text-white/60">
                  No spam. Just drops, restocks, and bundle alerts.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="sticky-cta-bar fixed bottom-4 left-1/2 z-40 hidden w-[min(94vw,680px)] -translate-x-1/2 translate-y-4 opacity-0 transition-all duration-300">
        <div className="metal-panel flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/15 px-3 py-2 backdrop-blur-md">
          <div className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] text-white/70 sm:block">
            Bundle &amp; save
          </div>
          <a href="#bundle-pricing" className="btn btn-red w-full sm:w-auto">
            Build my bundle
          </a>
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-white/80 underline underline-offset-4 hover:text-white"
          >
            Buy 1-3 bags on Amazon →
          </a>
        </div>
      </div>

      <HeroCTAWatcher />
    </main>
  );
}
