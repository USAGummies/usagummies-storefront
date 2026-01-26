import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "USA Gummies Bag Count Guides | Gifts, Parties, and Bulk Orders";
const PAGE_DESCRIPTION =
  "Explore USA Gummies bag count guides for gifts, parties, and bulk orders. Find the right bag count and save more per bag.";

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

export default function BundleGuidesPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Bag count guides
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Find the right USA Gummies bag count
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Use these guides to match bag count to the moment. Choose a gift bag count, plan party
            snacks, or order bulk gummy bears for teams and events.
          </p>
          <div className="mt-5">
            <OccasionBagPicker options={OCCASION_BAG_OPTIONS} defaultKey="gift" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {GUIDES.map((guide) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 hover:border-[rgba(15,27,45,0.22)] hover:shadow-[0_14px_30px_rgba(15,27,45,0.12)]"
              >
                <div className="text-sm font-black text-[var(--text)]">{guide.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{guide.description}</div>
                <div className="mt-3 text-xs font-semibold text-[var(--navy)]">
                  View guide {"->"}
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Shop now
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bag count FAQ
            </Link>
          </div>

          <div className="mt-4 text-xs text-[var(--muted)]">
            Made in the USA. No artificial dyes. Free shipping on 5+ bags.
          </div>
        </div>

        <AmericanDreamCallout variant="compact" tone="light" className="mt-6" showJoinButton={false} />
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
    </main>
  );
}
