import Link from "next/link";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/lp/PageHero";
import { USStoreMap } from "@/components/USStoreMap";
import { RETAILERS } from "@/data/retailers";
import {
  countStates,
  countStores,
  groupByState,
} from "@/lib/locations/helpers";

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
  const totalStores = countStores(RETAILERS);
  const totalStates = countStates(RETAILERS);
  const groupedStores = groupByState(RETAILERS);
  const hasStores = totalStores > 0;
  return (
    <main>
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

      <PageHero
        eyebrow="Find Us In Stores"
        headline="Stores"
        scriptAccent="across America."
        sub="Dye-free gummy bears, available at stores across the country. Find one near you or shop online."
        ctas={[
          { href: "/shop", label: "Shop online" },
          { href: "#stores", label: "Browse stores", variant: "light" },
        ]}
      />

      {/* Map section — count + state-grouped headline + empty state. */}
      <section id="stores" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Our Retail Partners ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              {hasStores ? (
                <>
                  {totalStores} {totalStores === 1 ? "store" : "stores"}
                  <br />
                  <span className="lp-script text-[var(--lp-red)]">across America.</span>
                </>
              ) : (
                <>
                  Stores
                  <br />
                  <span className="lp-script text-[var(--lp-red)]">coming soon.</span>
                </>
              )}
            </h2>
            <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
              {hasStores ? (
                <>
                  Across{" "}
                  <span className="font-bold text-[var(--lp-ink)]">
                    {totalStates} {totalStates === 1 ? "state" : "states"}
                  </span>{" "}
                  and growing. Find a store near you or{" "}
                  <Link
                    href="/shop"
                    className="font-bold text-[var(--lp-red)] underline underline-offset-4"
                  >
                    shop online
                  </Link>
                  .
                </>
              ) : (
                <>
                  Retail locations are being added as distributor sell-through is confirmed.
                  In the meantime, you can{" "}
                  <Link
                    href="/shop"
                    className="font-bold text-[var(--lp-red)] underline underline-offset-4"
                  >
                    shop online
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
          {hasStores ? (
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
            >
              <USStoreMap retailers={RETAILERS} />
            </div>
          ) : (
            <div
              className="border-[3px] border-dashed border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-10 text-center"
              role="status"
              aria-label="Map of the United States — retail locations coming soon"
            >
              <p className="lp-display text-[1.4rem] text-[var(--lp-ink)]">
                Map coming soon.
              </p>
              <p className="lp-sans mx-auto mt-3 max-w-md text-[0.95rem] text-[var(--lp-ink)]/75">
                We&rsquo;ll light this up with state-by-state coverage as soon as our
                first retail partners confirm sell-through.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* All locations — grouped by state, LP shadow cards. */}
      {hasStores ? (
        <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
            <div className="mb-10 text-center">
              <p className="lp-label mb-2 text-[var(--lp-red)]">
                ★ All Locations · {totalStores} {totalStores === 1 ? "store" : "stores"} · {totalStates}{" "}
                {totalStates === 1 ? "state" : "states"} ★
              </p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
                Find a
                <br />
                <span className="lp-script text-[var(--lp-red)]">store.</span>
              </h2>
            </div>
            {groupedStores.map((group) => (
              <div key={group.state} className="mb-10 last:mb-0">
                <div className="lp-label mb-4 text-[var(--lp-ink)]">
                  {group.state}{" "}
                  <span className="text-[var(--lp-ink)]/60">
                    ({group.stores.length} {group.stores.length === 1 ? "store" : "stores"})
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.stores.map((r, i) => (
                    <div
                      key={r.slug}
                      className="flex flex-col border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                      style={{
                        boxShadow:
                          i === 0
                            ? "5px 5px 0 var(--lp-red)"
                            : "5px 5px 0 var(--lp-ink)",
                      }}
                    >
                      <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)]">
                        {r.name}
                      </h3>
                      <div className="lp-sans mt-2 text-[0.95rem] text-[var(--lp-ink)]/82">
                        {r.address}
                      </div>
                      <div className="lp-sans text-[0.95rem] text-[var(--lp-ink)]/82">
                        {r.cityStateZip}
                      </div>
                      <div className="mt-3">
                        <span className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-2.5 py-1 text-[var(--lp-ink)]">
                          {r.storeType}
                        </span>
                      </div>
                      {r.note && (
                        <p className="lp-sans mt-3 text-[0.85rem] italic text-[var(--lp-ink)]/70">
                          {r.note}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4">
                        <a
                          href={r.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lp-label text-[var(--lp-red)] underline underline-offset-4"
                        >
                          Get directions →
                        </a>
                        {r.website && (
                          <a
                            href={r.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="lp-label text-[var(--lp-red)] underline underline-offset-4"
                          >
                            Visit website →
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid gap-5 lg:grid-cols-2">
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label text-[var(--lp-red)]">★ Also Available Online ★</p>
              <h3 className="lp-display mt-3 text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Order direct or on Amazon.
              </h3>
              <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                Can&rsquo;t find a store near you? Order direct from our website or from Amazon with
                Prime shipping.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/shop" className="lp-cta">
                  Shop online
                </Link>
                <a
                  href="https://www.amazon.com/dp/B0G1JK92TJ?maas=maas_adg_BA724FDB5D62533"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-cta lp-cta-light"
                >
                  Buy on Amazon
                </a>
              </div>
            </div>

            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
            >
              <p className="lp-label text-[var(--lp-red)]">★ Retail Partners Wanted ★</p>
              <h3 className="lp-display mt-3 text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Carry USA Gummies in your store.
              </h3>
              <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                Whether you&rsquo;re an independent shop, gift store, or grocery chain, we make it easy
                to stock dye-free gummy bears your customers will love.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/wholesale" className="lp-cta">
                  Apply for wholesale
                </Link>
                <a
                  href="https://www.faire.com/brand/bw_cqd5dvfzqu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-cta lp-cta-light"
                >
                  View on Faire
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Made in the USA ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            All natural,
            <br />
            <span className="lp-script text-[var(--lp-red)]">no artificial dyes.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/about" className="lp-cta lp-cta-light">
              Our story
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
