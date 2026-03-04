import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";
import { USStoreMap } from "@/components/USStoreMap";
import { RETAILERS } from "@/data/retailers";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com"))
    return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
    : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Where to Buy USA Gummies | Find Us In Stores";
const PAGE_DESCRIPTION =
  "Find USA Gummies dye-free gummy bears in stores across America. Locate a retailer near you or shop online.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/where-to-buy` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/where-to-buy`,
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

const pageJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Where to Buy USA Gummies",
  description: PAGE_DESCRIPTION,
  url: `${SITE_URL}/where-to-buy`,
  isPartOf: {
    "@type": "WebSite",
    name: "USA Gummies",
    url: SITE_URL,
  },
};

function retailerJsonLd(r: (typeof RETAILERS)[number]) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: r.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: r.address,
      addressLocality: r.cityStateZip.split(",")[0].trim(),
      addressRegion: r.state,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: r.lat,
      longitude: r.lng,
    },
    url: r.mapsUrl,
  };
}


export default function WhereToBuyPage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen pb-16">
      {/* Hero */}
      <div className="relative w-full h-[280px] sm:h-[340px] lg:h-[400px] overflow-hidden">
        <Image
          src="/brand/gallery/bag-shelf-space.jpg"
          alt="USA Gummies bags displayed on a retail shelf"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/50 to-[#1B2A4A]/75" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <div className="relative w-44 h-20 sm:w-52 sm:h-24 mb-3">
            <Image
              src="/brand/logo-full.png"
              alt="USA Gummies"
              fill
              sizes="208px"
              className="object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]"
            />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
            Find Us In Stores
          </h1>
          <p className="mt-2 text-sm text-white/85 max-w-md drop-shadow-sm">
            Dye-free gummy bears, available at stores across America.
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Where to Buy", href: "/where-to-buy" },
          ]}
        />
        <JsonLd data={pageJsonLd} />
        {RETAILERS.map((r) => (
          <JsonLd key={r.slug} data={retailerJsonLd(r)} />
        ))}

        {/* Logo */}
        <div className="flex justify-center py-6">
          <div className="relative w-40 h-20">
            <Image
              src="/brand/logo-full.png"
              alt="USA Gummies"
              fill
              sizes="160px"
              className="object-contain"
            />
          </div>
        </div>

        {/* Map Section */}
        <div className="candy-panel rounded-[36px] p-6 sm:p-8">
          <div className="text-center space-y-2 mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Our retail partners
            </div>
            <h2 className="text-2xl font-black text-[var(--text)] sm:text-3xl">
              {RETAILERS.length} stores and growing
            </h2>
            <p className="text-sm text-[var(--muted)] max-w-lg mx-auto">
              We&rsquo;re a young brand adding new retail partners regularly.
              Find a store near you or{" "}
              <Link
                href="/shop"
                className="font-semibold text-[var(--navy)] underline underline-offset-4"
              >
                shop online
              </Link>
              .
            </p>
          </div>
          <USStoreMap retailers={RETAILERS} />
        </div>

        {/* Retailer Cards */}
        <div className="mt-8">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)] mb-4">
            All locations
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RETAILERS.map((r) => (
              <div
                key={r.slug}
                className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-[0_6px_24px_rgba(15,27,45,0.06)] flex flex-col"
              >
                <div className="text-base font-black text-[var(--text)]">
                  {r.name}
                </div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  {r.address}
                </div>
                <div className="text-sm text-[var(--muted)]">
                  {r.cityStateZip}
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center rounded-full bg-[var(--surface-strong)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {r.storeType}
                  </span>
                </div>
                {r.note && (
                  <p className="mt-2 text-xs text-[var(--muted)] italic">
                    {r.note}
                  </p>
                )}
                <div className="mt-auto pt-4 flex flex-wrap gap-x-4 gap-y-1">
                  <a
                    href={r.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-[var(--navy)] underline underline-offset-4"
                  >
                    Get directions &rarr;
                  </a>
                  {r.website && (
                    <a
                      href={r.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-[var(--navy)] underline underline-offset-4"
                    >
                      Visit website &rarr;
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Also available online */}
        <div className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-5 shadow-[0_18px_44px_rgba(15,27,45,0.06)]">
          <div className="text-sm font-black text-[var(--text)]">
            Also available online
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Can&rsquo;t find a store near you? Order direct from our website or
            from Amazon with Prime shipping.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/shop" className="btn btn-candy pressable">
              Shop online
            </Link>
            <a
              href="https://www.amazon.com/dp/B0G1JK92TJ"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline pressable"
            >
              Buy on Amazon
            </a>
          </div>
        </div>

        {/* Wholesale CTA */}
        <div className="mt-8 candy-panel rounded-[36px] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Retail partners wanted
              </div>
              <h2 className="text-2xl font-black text-[var(--text)] sm:text-3xl">
                Want to carry USA Gummies in your store?
              </h2>
              <p className="text-sm text-[var(--muted)] max-w-prose">
                We&rsquo;re actively growing our retail footprint. Whether
                you&rsquo;re an independent shop, gift store, or grocery chain,
                we make it easy to stock dye-free gummy bears your customers
                will love.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/wholesale" className="btn btn-candy pressable">
                  Apply for wholesale
                </Link>
                <a
                  href="https://www.faire.com/brand/bw_cqd5dvfzqu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline pressable"
                >
                  View on Faire
                </a>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="relative w-56 h-56 sm:w-64 sm:h-64">
                <Image
                  src="/brand/usa-gummies-family.webp"
                  alt="Assorted USA Gummies gummy bear bags"
                  fill
                  sizes="256px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom details */}
        <div className="mt-6 flex items-center justify-center gap-3 text-xs text-[var(--muted)]">
          <Image
            src="/brand/logo.png"
            alt="USA Gummies logo"
            width={72}
            height={26}
            className="h-auto w-16 object-contain"
          />
          <span>Made in the USA &bull; All natural &bull; No artificial dyes</span>
        </div>
      </section>
    </main>
  );
}
