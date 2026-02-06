import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

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
const PAGE_TITLE = "America 250";
const PAGE_DESCRIPTION =
  "America 250 hub - patriotic gummy gifts and limited drops built for celebrating America's 250th.";
const PAGE_URL = `${SITE_URL}/america-250`;
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

const blogPostingJsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  url: PAGE_URL,
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

export default function America250HubPage() {
  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "America 250", href: "/america-250" },
          ]}
        />

        <div className="mb-6 flex items-center justify-between">
          <Link href="/shop" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Back to shop
          </Link>
          <Link href="/cart" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            View cart
          </Link>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
          <span className="font-semibold tracking-wide">AMERICA 250</span>
          <span className="text-[var(--muted)]">•</span>
          <span className="text-[var(--muted)]">Hub</span>
        </div>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight">America 250</h1>
        <p className="mt-4 text-[var(--muted)]">
          A focused hub for gifts, celebrations, and events tied to America&apos;s 250th - with
          limited-run gummy drops built for sharing.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Link
            href="/america-250/gifts"
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6 hover:bg-white"
          >
            <div className="text-lg font-semibold">Gifts</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              Patriotic gummy gift ideas and bag options.
            </div>
          </Link>

          <Link
            href="/america-250/celebrations"
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6 hover:bg-white"
          >
            <div className="text-lg font-semibold">Celebrations</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              Party ideas, parade snacks, and shareable bag options.
            </div>
          </Link>

          <Link
            href="/america-250/events"
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6 hover:bg-white"
          >
            <div className="text-lg font-semibold">Events</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              A simple page to pair with event-focused content.
            </div>
          </Link>
        </div>

        <div className="mt-10 candy-panel rounded-3xl border border-[var(--border)] p-6">
          <div className="grid gap-4 md:grid-cols-[1.3fr_0.7fr] md:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Featured bundle
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                America 250 gifting, ready to share.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Our most popular bag counts for patriotic gifts, community events, and celebration tables.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/shop?campaign=america250#bundle-pricing" className="btn btn-candy">
                  Shop America 250
                </Link>
                <Link href="/gummy-gift-bundles" className="btn btn-outline">
                  Gift bundles
                </Link>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                Add <span className="font-semibold text-[var(--text)]">?campaign=america250</span> to any product page.
              </p>
            </div>
            <div className="relative">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-3">
                <Image
                  src="/Hero-pack.jpeg"
                  alt="USA Gummies bag"
                  fill
                  sizes="(max-width: 768px) 80vw, 240px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
    </main>
  );
}
