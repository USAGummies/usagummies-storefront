import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";

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
const PAGE_TITLE = "Gummy Gift Bag Options | USA Gummies";
const PAGE_DESCRIPTION =
  "Gift-ready gummy bag options made in the USA. Choose 4, 5, 8, or 12 bags for birthdays, thank you gifts, and care packages.";

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
    detail: "4 bags for small thank you gifts and care packages.",
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
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
            { name: "Gummy gift bag options", href: "/gummy-gift-bundles" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Gift bag options
              </div>
              <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
                Gummy gift bag options made in the USA
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
                USA Gummies bags make easy gifts for birthdays, thank yous, and care packages. Pick the
                bag count that matches your list and ship fast.
              </p>
            </div>
            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                  <Image
                    src="/brand/usa-gummies-family.webp"
                    alt="USA Gummies gift bags"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {BUNDLE_IDEAS.map((idea) => (
              <div
                key={idea.title}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4"
              >
                <div className="text-sm font-black text-[var(--text)]">{idea.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{idea.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="gift"
              singleBagVariantId={singleBagVariantId}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Shop now
            </Link>
            <Link href="/ingredients" className="btn btn-outline">
              Ingredients
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bag count FAQ
            </Link>
          </div>

          <div className="mt-4 text-xs text-[var(--muted)]">
            Free shipping at 5+ bags. Savings grow as you add bags.
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </main>
  );
}
