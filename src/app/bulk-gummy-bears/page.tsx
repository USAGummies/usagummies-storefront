import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
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

export default async function BulkGummyBearsPage() {
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }
  const singleBagVariantId = bundleVariants?.singleBagVariantId;

  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
            { name: "Bulk gummy bears", href: "/bulk-gummy-bears" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
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
            </div>
            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                  <Image
                    src="/website%20assets/B17Bomber.png"
                    alt="Vintage B-17 bomber illustration"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

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
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="bulk"
              singleBagVariantId={singleBagVariantId}
            />
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
      </section>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <LatestFromBlog />
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </main>
  );
}
