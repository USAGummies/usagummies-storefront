// /patriotic-candy — patriotic-gifting hub in LP design language. Structure:
// PageHero → ScarcityBar → Highlights grid → Seasonal moments → Gift sizes →
// Ideas list → Related links → ThreePromises → GuaranteeBlock → bottom CTA.
// Article + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";

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
const PAGE_TITLE = "Patriotic Candy Gifts | USA Gummies";
const PAGE_DESCRIPTION =
  "Shop patriotic candy made in USA, including dye-free gummies with no artificial dyes for July 4th, Veterans Day, and America's 250th.";
const PAGE_URL = `${SITE_URL}/patriotic-candy`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    type: "article",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const HIGHLIGHTS = [
  {
    title: "Made in the USA",
    description: "American-made candy gifts with a premium, gift-ready feel.",
  },
  {
    title: "Clean ingredient standard",
    description: "All-natural flavors, no artificial dyes — colors from real fruit and vegetable extracts.",
  },
  {
    title: "Bundle-friendly gifting",
    description: "Pick 5, 8, or 12 bags for celebrations, parties, and bulk gifting.",
  },
];

const SEASONAL_MOMENTS = [
  {
    title: "July 4th patriotic candy",
    date: "July 4",
    description: "Firework-night bags for backyard cookouts, parade tables, and pool parties.",
    href: "/patriotic-party-snacks",
    cta: "July 4th party guide",
  },
  {
    title: "Veterans Day candy gifts",
    date: "Nov 11",
    description: "Thank-you gifts for service members, volunteers, and community groups.",
    href: "/gummy-gift-bundles",
    cta: "Gift bag options",
  },
  {
    title: "America's 250th gifts",
    date: "2026",
    description: "Celebrate America's 250th with patriotic candy gifts and themed bundles.",
    href: "/america-250",
    cta: "America's 250th hub",
  },
];

const GIFT_SIZES = [
  {
    title: "5-bag thank-you",
    description: `${FREE_SHIPPING_PHRASE} and an easy gift for hosts and helpers.`,
  },
  {
    title: "8-bag sharing pack",
    description: "Most popular for offices, family gatherings, and parade tables.",
  },
  {
    title: "12-bag celebration stash",
    description: "Built for big events, community groups, and America's 250th tables.",
  },
];

const IDEAS = [
  "Parade bags and fireworks-night share packs",
  "Veteran appreciation gifts for teams and volunteers",
  "America's 250th celebration tables and community events",
  "Corporate gifting with an all-American theme",
];

const RELATED_LINKS = [
  { href: "/made-in-usa", label: "Made in USA" },
  { href: "/gummy-gift-bundles", label: "Gift bag options" },
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/america-250/gifts", label: "America's 250th gifts" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Patriotic candy and American made candy gifts",
  description: PAGE_DESCRIPTION,
  // Conservative publish date — page predates audit but exact date unknown.
  datePublished: "2026-01-01",
  dateModified: "2026-04-29",
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": PAGE_URL,
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
  image: [OG_IMAGE],
};

export default function PatrioticCandyPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Patriotic Candy", href: "/patriotic-candy" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <PageHero
        eyebrow="Patriotic Candy"
        headline="Patriotic candy &amp;"
        scriptAccent="American-made gifts."
        sub="Shop American-made candy gifts built for July 4th, Veterans Day, and America's 250th. USA Gummies are made in the USA and packed for gifting or sharing."
        ctas={[
          { href: "/shop#bundle-pricing", label: "Shop &amp; save" },
          { href: "/made-in-usa", label: "Made in USA", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Highlights */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Standard ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Real candy.
              <br />
              <span className="lp-script text-[var(--lp-red)]">Real America.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HIGHLIGHTS.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-8 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            {FREE_SHIPPING_PHRASE}. Bundles ship fast for seasonal gifting.
          </p>
        </div>
      </section>

      {/* Seasonal moments */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Seasonal Moments ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Built for
              <br />
              <span className="lp-script text-[var(--lp-red)]">the calendar.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {SEASONAL_MOMENTS.map((moment, i) => (
              <div
                key={moment.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <span className="lp-label inline-block border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-3 py-1 text-[var(--lp-ink)]">
                  {moment.date}
                </span>
                <h3 className="lp-display mt-4 text-[1.3rem] leading-tight text-[var(--lp-ink)] sm:text-[1.45rem]">
                  {moment.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {moment.description}
                </p>
                <Link
                  href={moment.href}
                  className="lp-label mt-4 inline-block text-[var(--lp-red)]"
                >
                  {moment.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gift sizes */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Sorted by Bag Count ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Pick a size
              <br />
              <span className="lp-script text-[var(--lp-red)]">that fits the gift.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {GIFT_SIZES.map((size, i) => (
              <div
                key={size.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-red)] sm:text-[1.45rem]">
                  {size.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {size.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ideas */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Patriotic Candy Ideas ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Where the
              <br />
              <span className="lp-script text-[var(--lp-red)]">bags belong.</span>
            </h2>
          </div>
          <ul className="grid gap-4">
            {IDEAS.map((idea, i) => (
              <li
                key={idea}
                className="flex items-start gap-4 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <span className="lp-display mt-1 text-[1.4rem] leading-none text-[var(--lp-red)]">★</span>
                <span className="lp-sans text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">{idea}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Related */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Keep Reading ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              More
              <br />
              <span className="lp-script text-[var(--lp-red)]">patriotic picks.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {RELATED_LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-5 transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <span className="lp-display text-[1.1rem] leading-snug text-[var(--lp-ink)]">
                  {link.label}
                </span>
                <span className="lp-label mt-3 block text-[var(--lp-red)]">View →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <ThreePromises />
      <GuaranteeBlock />

      {/* Latest blog */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready When You Are ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Shop the
            <br />
            <span className="lp-script text-[var(--lp-red)]">red, white &amp; chewy.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop#bundle-pricing" className="lp-cta">
              Shop patriotic candy
            </Link>
            <Link href="/america-250" className="lp-cta lp-cta-light">
              America's 250th
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
