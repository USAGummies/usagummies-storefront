import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
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
const PAGE_TITLE = "Patriotic Candy Gifts | USA Gummies";
const PAGE_DESCRIPTION =
  "Shop patriotic candy made in USA, including dye-free gummies with no artificial dyes for July 4th, Veterans Day, and America 250.";
const PAGE_URL = `${SITE_URL}/patriotic-candy`;
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

const HIGHLIGHTS = [
  {
    title: "Made in the USA",
    description: "American made candy gifts with a premium, gift-ready feel.",
  },
  {
    title: "Clean ingredient standard",
    description: "All natural flavors and no artificial dyes.",
  },
  {
    title: "Bundle-friendly gifting",
    description: "Pick 5, 8, or 12 bags for celebrations and bulk gifting.",
  },
];

const SEASONAL_MOMENTS = [
  {
    title: "July 4th patriotic candy",
    date: "July 4",
    description: "Firework-night bags for backyard cookouts, parade tables, and pool parties.",
    href: "/patriotic-party-snacks",
    cta: "July 4th party guide",
  },
  {
    title: "Veterans Day candy gifts",
    date: "Nov 11",
    description: "Thank-you gifts for service members, volunteers, and community groups.",
    href: "/gummy-gift-bundles",
    cta: "Gift bag options",
  },
  {
    title: "America 250 gifts",
    date: "2026",
    description: "Celebrate America 250 with patriotic candy gifts and themed bundles.",
    href: "/america-250",
    cta: "America 250 hub",
  },
];

const GIFT_SIZES = [
  {
    title: "5-bag thank-you",
    description: `${FREE_SHIPPING_PHRASE} and an easy gift for hosts and helpers.`,
  },
  {
    title: "8-bag sharing pack",
    description: "Most popular for offices, family gatherings, and parade tables.",
  },
  {
    title: "12-bag celebration stash",
    description: "Built for big events, community groups, and America 250 tables.",
  },
];

const RELATED_LINKS = [
  { href: "/made-in-usa", label: "Made in USA" },
  { href: "/gummy-gift-bundles", label: "Gift bag options" },
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/america-250/gifts", label: "America 250 gifts" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Patriotic candy and American made candy gifts",
  description: PAGE_DESCRIPTION,
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

export default function PatrioticCandyPage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Patriotic Candy", href: "/patriotic-candy" },
          ]}
        />

        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Patriotic candy
              </div>
              <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
                Patriotic Candy &amp; American Made Candy Gifts
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Shop American made candy gifts built for July 4th, Veterans Day (November 11), and
                America 250. USA Gummies are made in the USA and packed for gifting or sharing.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link href="/shop#bundle-pricing" className="btn btn-candy">
                  Shop &amp; save
                </Link>
                <Link href="/made-in-usa" className="btn btn-outline">
                  Made in USA
                </Link>
                <Link href="/gummy-gift-bundles" className="btn btn-outline">
                  Gift bag options
                </Link>
              </div>
              <div className="mt-3 text-xs text-[var(--muted)]">
                {FREE_SHIPPING_PHRASE}. Bundles ship fast for seasonal gifting.
              </div>
            </div>
            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                  <Image
                    src="/website%20assets/StatueofLiberty.png"
                    alt="Statue of Liberty illustration"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {HIGHLIGHTS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4"
              >
                <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{item.description}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-4">
            <div className="text-sm font-black text-[var(--text)]">Seasonal patriotic candy moments</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {SEASONAL_MOMENTS.map((moment) => (
                <div key={moment.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {moment.date}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[var(--text)]">{moment.title}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">{moment.description}</div>
                  <Link
                    href={moment.href}
                    className="mt-3 inline-flex text-xs font-semibold text-[var(--navy)] link-underline"
                  >
                    {moment.cta} {"->"}
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
            <div className="text-sm font-black text-[var(--text)]">
              American made candy gifts, sorted by bag count
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {GIFT_SIZES.map((size) => (
                <div key={size.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {size.title}
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">{size.description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-4">
            <div className="text-sm font-black text-[var(--text)]">Patriotic candy ideas</div>
            <ul className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
              <li>• Parade bags and fireworks-night share packs</li>
              <li>• Veteran appreciation gifts for teams and volunteers</li>
              <li>• America 250 celebration tables and community events</li>
              <li>• Corporate gifting with an all-American theme</li>
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Shop patriotic candy
            </Link>
            <Link href="/america-250" className="btn btn-outline">
              America 250
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bag count FAQ
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RELATED_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 text-sm font-semibold text-[var(--text)] hover:border-[rgba(15,27,45,0.22)]"
            >
              {link.label} {"->"}
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
