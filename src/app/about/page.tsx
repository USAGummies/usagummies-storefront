import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { FREE_SHIPPING_PHRASE, pricingForQty } from "@/lib/bundles/pricing";

export const metadata: Metadata = {
  title: "About USA Gummies | All Natural, Dye-Free, Made in the USA",
  description:
    "USA Gummies makes premium gummy bears with all natural flavors, no artificial dyes, and U.S. manufacturing. Bundle pricing saves per bag and 5+ bags ship free. Also available on Amazon.",
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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
      {children}
    </span>
  );
}

export default function AboutPage() {
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
  const bundleSavingsLine =
    bestValueSavingsPct > 0
      ? `Bundle pricing lowers the per-bag cost from ${starterPerBag} to ${bestValuePerBag} when you choose 8 bags (${bestValueSavingsPct}% less per bag).`
      : "Bundle pricing lowers the per-bag cost as you add more bags.";

  return (
    <main className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen home-metal">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(199,54,44,0.2), transparent 45%), radial-gradient(circle at 85% 5%, rgba(255,255,255,0.08), transparent 35%)",
            opacity: 0.6,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "About", href: "/about" },
            ]}
          />

          <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.35)] p-6 sm:p-8 shadow-[0_32px_90px_rgba(7,12,20,0.55)]">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70 sm:text-xs">
                  <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1">
                    Made in the USA
                  </span>
                  <span className="text-[var(--gold)]">No artificial dyes</span>
                </div>

                <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
                  Built for people who read labels.
                </h1>

                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  USA Gummies exists for a simple reason: candy should taste incredible
                  without looking like a science experiment. We make gummy bears with
                  all natural flavors, no artificial dyes or synthetic colors, and proud
                  U.S. manufacturing. Classic gummy bear flavor - done right.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Pill>All natural flavors</Pill>
                  <Pill>Classic gummy bear flavor</Pill>
                  <Pill>Made in USA</Pill>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-red">
                    Shop bundles
                  </Link>
                  <a
                    href={AMAZON_LISTING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-white"
                  >
                    Buy 1-3 bags on Amazon
                  </a>
                  <span className="text-xs text-white/65">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_26px_70px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                    <Image
                      src="/brand/hero.jpg"
                      alt="USA Gummies bag"
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Best seller
                    </div>
                    <div className="text-lg font-black text-[var(--navy)]">
                      USA Gummies - All American Gummy Bears
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      From {starterPerBag} per bag
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">No artificial dyes</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">No artificial dyes</div>
                <div className="mt-1 text-sm text-white/70">
                  Cleaner ingredients and a clean finish, made for people who care what goes in.
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">All natural flavors</div>
                <div className="mt-1 text-sm text-white/70">
                  Great taste without the fake, neon vibe. Simple, premium, shareable.
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Made in the USA</div>
                <div className="mt-1 text-sm text-white/70">
                  Proudly sourced, manufactured, and packed entirely in America.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                Bundle savings
              </div>
              <h2 className="mt-2 text-2xl font-black text-white">
                Bundle pricing saves you money.
              </h2>
              <p className="mt-2 text-sm text-white/75">{bundleSavingsLine}</p>
              <div className="mt-3 text-sm text-white/70">{FREE_SHIPPING_PHRASE}.</div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">
                    Single bag
                  </div>
                  <div className="text-base font-black text-white">{starterPerBag} per bag</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">
                    Best value
                  </div>
                  <div className="text-base font-black text-white">{bestValuePerBag} per bag</div>
                  <div className="text-[11px] text-white/65">8-bag bundle</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">
                    Free shipping
                  </div>
                  <div className="text-base font-black text-white">5+ bags</div>
                  <div className="text-[11px] text-white/65">Orders ship free</div>
                </div>
              </div>
            </div>

            <div className="metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                Also on Amazon
              </div>
              <h2 className="mt-2 text-2xl font-black text-white">
                Find USA Gummies on Amazon.
              </h2>
              <p className="mt-2 text-sm text-white/75">
                Prefer Amazon checkout? We also sell on Amazon for 1-3 bag orders. Same
                product, same ingredients, same American-made quality.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                >
                  View Amazon listing
                </a>
                <Link href="/shop" className="btn btn-red">
                  Shop bundles
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                  Founder-led, quality-first
                </div>
                <h2 className="text-2xl font-black text-white">American-made candy, done right.</h2>
                <p className="text-white/75">
                  USA Gummies started with a simple goal: make gummy bears that taste
                  incredible and feel good to share without artificial dyes. We keep
                  production close, ingredients clean, and quality consistent.
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-white/70">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Made in America
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Small-batch care
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Clean ingredients
                  </span>
                </div>
              </div>

              <div className="rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_22px_60px_rgba(7,12,20,0.35)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                  <Image
                    src="/home-patriotic-product.jpg"
                    alt="USA Gummies made in the USA"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 md:items-center">
              <div>
                <h3 className="text-xl font-black text-white">Crafted in America</h3>
                <p className="mt-2 text-white/75">
                  USA Gummies are made in the United States with clean ingredients and real,
                  fruit-forward flavor. No artificial dyes and no weird aftertaste.
                </p>
                <p className="mt-2 text-white/75">
                  We keep the process simple: quality ingredients, consistent texture, and a bag
                  that is ready for everyday snacking or gifting.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href="/shop" className="btn btn-red">
                    Shop bundles
                  </Link>
                  <Link href="/contact" className="btn btn-outline-white">
                    Contact
                  </Link>
                </div>
              </div>

              <div className="rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_22px_60px_rgba(7,12,20,0.35)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                  <Image
                    src="/brand/hero.jpg"
                    alt="USA Gummies - all natural flavors, no artificial dyes"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-cover"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill>All natural flavors</Pill>
                  <Pill>No artificial dyes</Pill>
                  <Pill>Made in USA</Pill>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
