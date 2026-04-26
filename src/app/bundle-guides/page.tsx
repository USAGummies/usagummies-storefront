// /bundle-guides — index page in LP design language listing bag-count guides.
// Structure: PageHero → ScarcityBar → OccasionBagPicker (client) → Guide grid
// → ThreePromises → GuaranteeBlock → bottom CTA. ItemList + Breadcrumb
// JSON-LD preserved for SEO.

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
const PAGE_TITLE = "Bundle Guides | USA Gummies";
const PAGE_DESCRIPTION =
  "Pick the right gummy bundle for gifts, parties, and patriotic candy celebrations. Dye-free gummies made in the USA.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/bundle-guides` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/bundle-guides`,
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

const GUIDES = [
  {
    href: "/gummy-gift-bundles",
    title: "Gummy gift bag options",
    description: "Gift-ready bag counts for birthdays, thank yous, and care packages.",
  },
  {
    href: "/patriotic-party-snacks",
    title: "Patriotic party snacks",
    description: "Bag-count picks for July 4th and USA-themed events.",
  },
  {
    href: "/patriotic-candy",
    title: "Patriotic candy gifts",
    description: "American-made candy gifts for July 4th, Veterans Day, and America 250.",
  },
  {
    href: "/bulk-gummy-bears",
    title: "Bulk gummy bears",
    description: "Crowd-ready bag counts for teams, clients, and events.",
  },
];

const itemListJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: GUIDES.map((guide, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: guide.title,
    url: `${SITE_URL}${guide.href}`,
  })),
};

export default async function BundleGuidesPage() {
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
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <PageHero
        eyebrow="Bag Count Guides"
        headline="Find the right"
        scriptAccent="bag count."
        sub="Match bag count to the moment. Choose a gift bag count, plan party snacks, or order bulk gummy bears for teams and events."
        ctas={[
          { href: "/shop#bundle-pricing", label: "Shop now" },
          { href: "/faq", label: "Bag count FAQ", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Bag picker */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Pick Your Occasion ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Built for gifting,
              <br />
              <span className="lp-script text-[var(--lp-red)]">parties &amp; bulk.</span>
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

      {/* Guide grid */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Guides ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Pick the path
              <br />
              <span className="lp-script text-[var(--lp-red)]">that fits.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {GUIDES.map((guide, i) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6 transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.25rem] leading-tight text-[var(--lp-ink)] sm:text-[1.4rem]">
                  {guide.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {guide.description}
                </p>
                <span className="lp-label mt-4 block text-[var(--lp-red)]">View guide →</span>
              </Link>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-10 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            Made in the USA. No artificial dyes. Free shipping on 5+ bags.
          </p>
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
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Pick &amp; Ship ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Skip the guesswork,
            <br />
            <span className="lp-script text-[var(--lp-red)]">grab the bag.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop#bundle-pricing" className="lp-cta">
              Shop now
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
