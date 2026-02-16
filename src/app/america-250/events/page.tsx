import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
const PAGE_TITLE = "America 250 Events | USA Gummies";
const PAGE_DESCRIPTION =
  "Find America 250 event ideas and patriotic candy selections, including dye-free gummies made in the USA.";
const PAGE_URL = `${SITE_URL}/america-250/events`;
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

export default function America250EventsPage() {
  return (
    <main className="min-h-screen text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "America 250", href: "/america-250" },
            { name: "Events", href: "/america-250/events" },
          ]}
        />

        <div className="mb-6">
          <Link href="/america-250" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Back to America 250
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 events</h1>
        <p className="mt-4 text-[var(--muted)]">
          A curated set of bundle sizes built for parades, community events, and patriotic gatherings.
        </p>

        <div className="mt-8 candy-panel rounded-3xl border border-[var(--border)] p-6">
          <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Event essentials
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Built for teams, tents, and town squares.
              </h2>
              <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                <li>• 8 bags: most popular for sharing tables</li>
                <li>• 12 bags: best value for large groups</li>
                <li>• Free shipping on 5+ bags</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/shop?campaign=america250#bundle-pricing" className="btn btn-candy">
                  Shop event bundles
                </Link>
                <Link href="/bulk-gummy-bears" className="btn btn-outline">
                  Bulk orders
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-3">
                <Image
                  src="/website%20assets/Truck.png"
                  alt="Delivery truck illustration"
                  fill
                  sizes="(max-width: 768px) 80vw, 240px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <BlogPostingJsonLd
        headline={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        url={PAGE_URL}
        image={OG_IMAGE}
        datePublished={PUBLISHED_DATE}
        dateModified={MODIFIED_DATE}
        publisherLogoUrl={`${SITE_URL}/brand/logo.png`}
      />
    </main>
  );
}
