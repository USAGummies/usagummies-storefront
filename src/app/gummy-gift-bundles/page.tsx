// /gummy-gift-bundles — gift-funnel page in LP design language. Structure:
// PageHero → ScarcityBar → Gift-bundle ideas grid → OccasionBagPicker
// (client) → Related guides → ThreePromises → GuaranteeBlock → bottom CTA.
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
const PAGE_TITLE = "Gummy Gift Bundles | Patriotic Candy";
const PAGE_DESCRIPTION =
  "Send made in USA candy gifts with dye-free gummies and no artificial dyes. Bundles for birthdays, teams, and holidays.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/gummy-gift-bundles` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/gummy-gift-bundles`,
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

const BUNDLE_IDEAS = [
  {
    title: "Starter gift",
    detail: "4 bags for small thank-you gifts and care packages.",
  },
  {
    title: "Free shipping pick",
    detail: "5 bags to unlock free shipping and easy gifting.",
  },
  {
    title: "Most popular gift",
    detail: "8 bags for office gifting, family packs, and parties.",
  },
  {
    title: "Bulk gifting",
    detail: "12 bags for teams, clients, and large events.",
  },
];

const RELATED_GUIDES = [
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  { href: "/bundle-guides", label: "All bag count guides" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Gummy gift bag options made in the USA",
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/gummy-gift-bundles`,
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

export default async function GummyGiftBundlesPage() {
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
          { name: "Gummy gift bag options", href: "/gummy-gift-bundles" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <PageHero
        eyebrow="Gift Bag Options"
        headline="Gummy gift bags"
        scriptAccent="made in the USA."
        sub="USA Gummies bags make easy gifts for birthdays, thank-yous, and care packages. Pick the bag count that matches your list and ship fast."
        ctas={[
          { href: "/shop#bundle-pricing", label: "Shop gift bundles" },
          { href: "/ingredients", label: "Ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Bundle ideas */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Bundle Ideas ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              From thank-yous
              <br />
              <span className="lp-script text-[var(--lp-red)]">to team gifts.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {BUNDLE_IDEAS.map((idea, i) => (
              <div
                key={idea.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.6rem]">
                  {idea.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {idea.detail}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-8 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            Free shipping at 5+ bags. Savings grow as you add bags.
          </p>
        </div>
      </section>

      {/* Bag picker */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Pick Your Bag Count ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Match the gift
              <br />
              <span className="lp-script text-[var(--lp-red)]">to the moment.</span>
            </h2>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="gift"
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
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Easy Gift, Fast Ship ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Send a bag
            <br />
            <span className="lp-script text-[var(--lp-red)]">today.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop#bundle-pricing" className="lp-cta">
              Shop gift bundles
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
