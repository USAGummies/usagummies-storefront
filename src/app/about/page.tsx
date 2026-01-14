import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { FREE_SHIPPING_PHRASE, pricingForQty } from "@/lib/bundles/pricing";

const LISTING_TITLE =
  "USA Gummies – All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors";

const LISTING_BULLETS = [
  {
    title: "MADE IN THE USA",
    body:
      "Proudly sourced, manufactured, and packed entirely in America. Supporting local jobs while delivering a better-quality gummy you can trust.",
  },
  {
    title: "NO ARTIFICIAL DYES OR SYNTHETIC COLORS",
    body:
      "Colored naturally using real fruit and vegetable extracts. No fake brightness, no artificial dyes.",
  },
  {
    title: "CLASSIC GUMMY BEAR FLAVOR — DONE RIGHT",
    body:
      "All the chewy, fruity flavor you expect from a gummy bear, just without artificial ingredients or harsh aftertaste.",
  },
  {
    title: "PERFECT FOR EVERYDAY SNACKING",
    body:
      "Great for lunchboxes, desk drawers, road trips, care packages, and guilt-free sweet cravings.",
  },
  {
    title: "7.5 OZ BAG WITH 5 FRUIT FLAVORS",
    body:
      "Cherry, Watermelon, Orange, Green Apple, and Lemon. Clearly labeled, honestly made, and easy to share.",
  },
];

export const metadata: Metadata = {
  title: LISTING_TITLE,
  description: LISTING_TITLE,
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

                <h1 className="text-3xl font-black leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-5xl">
                  {LISTING_TITLE}
                </h1>

                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  {LISTING_BULLETS[0].body}
                </p>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  {LISTING_BULLETS[1].body}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Pill>Made in the USA</Pill>
                  <Pill>No artificial dyes or synthetic colors</Pill>
                  <Pill>7.5 oz bag with 5 fruit flavors</Pill>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-red">
                    Shop bundles
                  </Link>
                  <span className="text-xs text-white/65">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_26px_70px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                    <Image
                      src="/brand/hero.jpg"
                      alt={LISTING_TITLE}
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      {LISTING_BULLETS[4].title}
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      {LISTING_BULLETS[4].body}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">No artificial dyes</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LISTING_BULLETS.map((bullet) => (
                <div
                  key={bullet.title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    {bullet.title}
                  </div>
                  <div className="mt-2 text-sm text-white/75">{bullet.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <AmericanDreamCallout ctaHref="/shop" ctaLabel="Shop bundles" />
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
                    Most popular
                  </div>
                  <div className="text-base font-black text-white">{bestValuePerBag} per bag</div>
                  <div className="text-[11px] text-white/65">8-bag bundle</div>
                  <div className="text-[11px] text-[var(--gold)]/90">
                    Best balance of value + convenience
                  </div>
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

          </div>
        </div>
      </section>
    </main>
  );
}
