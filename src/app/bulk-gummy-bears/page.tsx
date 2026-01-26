import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Bulk Gummy Bears | USA Gummies Bag Counts";
const PAGE_DESCRIPTION =
  "Bulk gummy bears for events, teams, and gifting. Add more bags for better per bag value and fast shipping.";

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
    detail: "12 bags work well for large teams and company events.",
  },
  {
    title: "Popular value",
    detail: "8 bags balance value and convenience for bulk gifting.",
  },
  {
    title: "Free shipping",
    detail: "5+ bags unlock free shipping for bulk orders.",
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

export default function BulkGummyBearsPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
            { name: "Bulk gummy bears", href: "/bulk-gummy-bears" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Bulk bag counts
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Bulk gummy bears for events and gifting
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Stock up with USA Gummies for teams, clients, and large gatherings. Add more bags to
            save per bag with fast shipping and made in the USA quality.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {BULK_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4"
              >
                <div className="text-sm font-black text-[var(--text)]">{benefit.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{benefit.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <OccasionBagPicker options={OCCASION_BAG_OPTIONS} defaultKey="bulk" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Shop now
            </Link>
            <Link href="/contact" className="btn btn-outline">
              Contact for large orders
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bag count FAQ
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {RELATED_GUIDES.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 text-sm font-semibold text-[var(--text)] hover:border-[rgba(15,27,45,0.22)]"
            >
              {guide.label} {"->"}
            </Link>
          ))}
        </div>

        <AmericanDreamCallout variant="compact" tone="light" className="mt-6" showJoinButton={false} />
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </main>
  );
}
