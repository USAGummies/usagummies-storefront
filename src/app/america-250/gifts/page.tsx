// /america-250/gifts — patriotic-gift funnel page in LP design language.
// Structure: PageHero → ScarcityBar → Gift bundle picks → ThreePromises →
// bottom CTA. BlogPosting + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { BlogPostingJsonLd } from "@/components/seo/BlogPostingJsonLd";

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
const PAGE_TITLE = "America 250 Gifts | Patriotic Candy";
const PAGE_DESCRIPTION =
  "Gift made in USA candy for America 250 - dye-free gummies and no artificial dyes for patriotic celebrations.";
const PAGE_URL = `${SITE_URL}/america-250/gifts`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;
const PUBLISHED_DATE = "2026-01-01T15:10:31-08:00";
const MODIFIED_DATE = "2026-02-05T22:32:05-08:00";

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

const GIFT_BUNDLES = [
  {
    title: "5 bags",
    body: "Easy gift with free shipping. Right-sized for thank-yous, hostess gifts, and care packages.",
    badge: "Free shipping",
  },
  {
    title: "8 bags",
    body: "Most popular for hosting and sharing. The bag-count people pick when they want to look generous without overdoing it.",
    badge: "Most popular",
  },
  {
    title: "12 bags",
    body: "Stock-up size for office gifting, party tables, and group thank-you orders. Free shipping included.",
    badge: "Stock-up",
  },
];

export default function America250GiftsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "America 250", href: "/america-250" },
          { name: "Gifts", href: "/america-250/gifts" },
        ]}
      />

      <BlogPostingJsonLd
        headline={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        url={PAGE_URL}
        image={OG_IMAGE}
        datePublished={PUBLISHED_DATE}
        dateModified={MODIFIED_DATE}
        publisherLogoUrl={`${SITE_URL}/brand/logo.png`}
      />

      <PageHero
        eyebrow="America 250 / Gifts"
        headline="Thank-yous, care packages,"
        scriptAccent="and celebrations."
        sub="Simple, gift-ready bag options with an Americana feel — built to show up looking premium."
        ctas={[
          { href: "/shop?campaign=america250#bundle-pricing", label: "Shop gift bundles" },
          { href: "/gummy-gift-bundles", label: "Gift guides", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Gift bundle grid */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Gift-Ready Picks ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Easy gifts.
              <br />
              <span className="lp-script text-[var(--lp-red)]">Real candy.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {GIFT_BUNDLES.map((bundle, i) => (
              <div
                key={bundle.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <span className="lp-label inline-block border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-3 py-1 text-[var(--lp-ink)]">
                  {bundle.badge}
                </span>
                <h3 className="lp-display mt-4 text-[1.6rem] leading-tight text-[var(--lp-red)] sm:text-[1.9rem]">
                  {bundle.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {bundle.body}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-10 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            Tip: <span className="font-semibold text-[var(--lp-ink)]">?campaign=america250</span> unlocks the patriotic naming on the shop page.
          </p>
        </div>
      </section>

      <ThreePromises />

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Send the Bag ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Ship a gift
            <br />
            <span className="lp-script text-[var(--lp-red)]">they&rsquo;ll actually open.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop?campaign=america250#bundle-pricing" className="lp-cta">
              Shop gift bundles
            </Link>
            <Link href="/america-250" className="lp-cta lp-cta-light">
              Back to America 250
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
