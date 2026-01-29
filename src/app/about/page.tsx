import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE, pricingForQty } from "@/lib/bundles/pricing";
import { BRAND_STORY_HEADLINE, BRAND_STORY_PARAGRAPHS } from "@/data/brandStory";

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
const PAGE_TITLE = "About USA Gummies | Made in the USA Gummy Bears";
const PAGE_DESCRIPTION =
  "Learn how USA Gummies are sourced, made, and packed in America with all natural flavors and no artificial dyes.";
const OG_IMAGE = "/opengraph-image";

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

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/about`,
  },
  author: {
    "@type": "Organization",
    name: "USA Gummies",
  },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo.png`,
    },
  },
  image: [`${SITE_URL}/brand/usa-gummies-family.webp`],
};

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/about`,
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
    <span className="candy-pill">
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
      ? `Savings pricing lowers the per-bag cost from ${starterPerBag} to ${bestValuePerBag} when you choose 8 bags (${bestValueSavingsPct}% less per bag).`
      : "Savings pricing lowers the per-bag cost as you add more bags.";

  return (
    <main className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(255,77,79,0.14), transparent 48%), radial-gradient(circle at 85% 5%, rgba(255,199,44,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "About", href: "/about" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)] sm:text-xs">
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[var(--text)]">
                    Made in the USA
                  </span>
                  <span className="text-[var(--red)]">No artificial dyes</span>
                </div>

                <h1 className="text-3xl font-black leading-[1.12] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  {LISTING_TITLE}
                </h1>

                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  {LISTING_BULLETS[0].body}
                </p>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  {LISTING_BULLETS[1].body}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Pill>Made in the USA</Pill>
                  <Pill>No artificial dyes or synthetic colors</Pill>
                  <Pill>7.5 oz bag with 5 fruit flavors</Pill>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop now
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt={LISTING_TITLE}
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-contain"
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
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {bullet.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{bullet.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Our story
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  {BRAND_STORY_HEADLINE}
                </h2>
                <div className="mt-4 space-y-3 text-sm text-[var(--muted)]">
                  {BRAND_STORY_PARAGRAPHS.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Savings by bag count
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  Bag-count pricing saves you money.
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">{bundleSavingsLine}</p>
                <div className="mt-3 text-sm text-[var(--muted)]">{FREE_SHIPPING_PHRASE}.</div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                      Single bag
                    </div>
                    <div className="text-base font-black text-[var(--text)]">{starterPerBag} per bag</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                      Most popular
                    </div>
                    <div className="text-base font-black text-[var(--text)]">{bestValuePerBag} per bag</div>
                    <div className="text-[11px] text-[var(--muted)]">8-bag total</div>
                    <div className="text-[11px] text-[var(--red)]">
                      Best balance of value + convenience
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                      Free shipping
                    </div>
                    <div className="text-base font-black text-[var(--text)]">5+ bags</div>
                    <div className="text-[11px] text-[var(--muted)]">Orders ship free</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </main>
  );
}
