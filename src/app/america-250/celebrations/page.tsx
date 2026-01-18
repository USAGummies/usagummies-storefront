import type { Metadata } from "next";
import Link from "next/link";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "America 250 Celebrations";
const PAGE_DESCRIPTION =
  "America 250 celebrations — party ideas and patriotic bundle snacks built for sharing.";
const PAGE_URL = `${SITE_URL}/america-250/celebrations`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
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

export default function America250CelebrationsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="mb-6">
          <Link href="/america-250" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            ← Back to America 250
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 celebrations</h1>
        <p className="mt-4 text-[var(--muted)]">
          Built for parades, cookouts, road trips, and community events. Same premium gummies — just
          bundled and positioned for the moment.
        </p>

        <div className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6">
          <div className="text-sm font-semibold">Ways people use these</div>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
            <li>• Party favor bowls</li>
            <li>• Parade snack packs</li>
            <li>• Gift add-ons</li>
            <li>• Road trip stash</li>
          </ul>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
    </main>
  );
}
