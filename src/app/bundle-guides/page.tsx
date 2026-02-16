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
    description: "American made candy gifts for July 4th, Veterans Day, and America 250.",
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
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bag count guides", href: "/bundle-guides" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
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
            </div>
            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                  <Image
                    src="/Hero-pack.jpeg"
                    alt="USA Gummies gummy bear bag"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="gift"
              singleBagVariantId={singleBagVariantId}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

      </section>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <LatestFromBlog />
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
    </main>
  );
}
