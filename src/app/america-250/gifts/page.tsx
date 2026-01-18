import type { Metadata } from "next";
import Link from "next/link";
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
const PAGE_TITLE = "America 250 Gifts";
const PAGE_DESCRIPTION =
  "America 250 gifts — patriotic gummy bundles built for hosting, gifting, and sharing.";
const PAGE_URL = `${SITE_URL}/america-250/gifts`;
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

export default function America250GiftsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "America 250", href: "/america-250" },
            { name: "Gifts", href: "/america-250/gifts" },
          ]}
        />

        <div className="mb-6 flex items-center justify-between">
          <Link href="/america-250" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            ← Back to America 250
          </Link>
          <Link href="/shop" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Shop →
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 gifts</h1>
        <p className="mt-4 text-[var(--muted)]">
          Simple, gift-ready bundles with an Americana feel — built to show up looking premium.
        </p>

        <div className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6">
          <div className="text-sm font-semibold">Quick picks</div>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
            <li>• 5 bags: easy gift, Free shipping on 5+ bags</li>
            <li>• 8 bags: most popular for hosting + sharing</li>
            <li>• 12 bags: stock-up / party table</li>
          </ul>

          <p className="mt-4 text-xs text-[var(--muted)]">
            Tip: Use <span className="font-semibold text-[var(--text)]">?campaign=america250</span> for the special naming mode.
          </p>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
    </main>
  );
}
