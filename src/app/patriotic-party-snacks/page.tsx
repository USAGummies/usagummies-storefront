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
const PAGE_TITLE = "Patriotic Party Snacks | USA Gummies Bag Options";
const PAGE_DESCRIPTION =
  "Patriotic party snacks and gummy bag options for July 4th and USA-themed events. Add more bags to save more.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/patriotic-party-snacks` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/patriotic-party-snacks`,
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

const PARTY_TIPS = [
  "8 bags are the most popular for backyard parties.",
  "12 bags are best for large groups and team events.",
  "5+ bags unlock free shipping for party planning.",
];

const RELATED_GUIDES = [
  { href: "/gummy-gift-bundles", label: "Gummy gift bag options" },
  { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  { href: "/bundle-guides", label: "All bag count guides" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Patriotic party snacks and gummy bag options",
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/patriotic-party-snacks`,
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

export default function PatrioticPartySnacksPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
            { name: "Patriotic party snacks", href: "/patriotic-party-snacks" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Party snacks
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Patriotic party snacks and gummy bag options
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Hosting a July 4th party or an America-themed event? USA Gummies bags make easy
            shareable snacks. Shop now and save for crowd-ready gummy bears.
          </p>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
            <div className="text-sm font-black text-[var(--text)]">Party sizing tips</div>
            <ul className="mt-2 grid gap-2 text-xs text-[var(--muted)]">
              {PARTY_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[var(--gold)]" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-6">
            <OccasionBagPicker options={OCCASION_BAG_OPTIONS} defaultKey="party" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Shop now and save
            </Link>
            <Link href="/made-in-usa" className="btn btn-outline">
              Made in USA
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
