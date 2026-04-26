// /bulk-gummy-bears — bulk-buy funnel page in LP design language. Structure:
// PageHero → ScarcityBar → Bulk-benefits grid → OccasionBagPicker (client) →
// Related guides → ThreePromises → GuaranteeBlock → bottom CTA.
// Article + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
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
const PAGE_TITLE = "Bulk Gummy Bears | Made in USA Candy";
const PAGE_DESCRIPTION =
  "Stock up on dye-free gummies in bulk. Made in USA candy for events, offices, and patriotic celebrations.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/bulk-gummy-bears` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/bulk-gummy-bears`,
    type: "article",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

const BULK_BENEFITS = [
  {
    title: "Event ready",
    detail: "12 bags work well for large teams, school days, and company events.",
  },
  {
    title: "Popular value",
    detail: "8 bags balance value and convenience for bulk gifting and parties.",
  },
  {
    title: "Free shipping",
    detail: "5+ bags unlock free shipping on every bulk order.",
  },
];

const RELATED_GUIDES = [
  { href: "/gummy-gift-bundles", label: "Gummy gift bag options" },
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/bundle-guides", label: "All bag count guides" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Bulk gummy bears for events and gifting",
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/bulk-gummy-bears`,
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
};

export default async function BulkGummyBearsPage() {
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }
  const singleBagVariantId = bundleVariants?.singleBagVariantId;

  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Bag count guides", href: "/bundle-guides" },
          { name: "Bulk gummy bears", href: "/bulk-gummy-bears" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <PageHero
        eyebrow="Bulk Bag Counts"
        headline="Bulk gummy bears for"
        scriptAccent="events &amp; gifting."
        sub="Stock up with USA Gummies for teams, clients, and large gatherings. Add more bags to save per bag — fast shipping, made in the USA."
        ctas={[
          { href: "/shop#bundle-pricing", label: "Shop bulk now" },
          { href: "/contact", label: "Contact for large orders", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Bulk benefits */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why Buy Bulk ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              More bags,
              <br />
              <span className="lp-script text-[var(--lp-red)]">better per-bag price.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {BULK_BENEFITS.map((b, i) => (
              <div
                key={b.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.6rem]">
                  {b.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {b.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bag picker — preserve client component */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Pick Your Bag Count ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Built for the
              <br />
              <span className="lp-script text-[var(--lp-red)]">whole crew.</span>
            </h2>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="bulk"
              singleBagVariantId={singleBagVariantId}
            />
          </div>
        </div>
      </section>

      {/* Related guides */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Keep Reading ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Other bag-count
              <br />
              <span className="lp-script text-[var(--lp-red)]">guides.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {RELATED_GUIDES.map((guide, i) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-5 transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <span className="lp-display text-[1.15rem] leading-snug text-[var(--lp-ink)]">
                  {guide.label}
                </span>
                <span className="lp-label mt-3 block text-[var(--lp-red)]">View guide →</span>
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
            Stock up
            <br />
            <span className="lp-script text-[var(--lp-red)]">today.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop#bundle-pricing" className="lp-cta">
              Shop bulk now
            </Link>
            <Link href="/faq" className="lp-cta lp-cta-light">
              Bag count FAQ
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
