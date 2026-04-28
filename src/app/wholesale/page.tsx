import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/lp/PageHero";
import { WholesaleForm } from "./WholesaleForm";

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
const PAGE_TITLE = "Wholesale | USA Gummies";
const PAGE_DESCRIPTION =
  "Request wholesale pricing for USA Gummies — premium dye-free gummy candy made in America. For retailers, distributors, and bulk buyers.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/wholesale` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/wholesale`,
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

const VALUE_BULLETS = [
  "All-natural gummy bears with no artificial dyes.",
  "Made in the USA at FDA-registered, cGMP-certified facilities.",
  "7.5 oz bags — classic gummy bear flavor, five fruit flavors.",
  "Patriotic packaging built for shelf and gift sets.",
];

const pageJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Wholesale USA Gummies",
  description: PAGE_DESCRIPTION,
  url: `${SITE_URL}/wholesale`,
  isPartOf: {
    "@type": "WebSite",
    name: "USA Gummies",
    url: SITE_URL,
  },
};

export default function WholesalePage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Wholesale", href: "/wholesale" },
        ]}
      />
      <JsonLd data={pageJsonLd} />

      {/* Utility nav — already a buyer link, top-right, doesn't compete with the form */}
      <div className="bg-[var(--lp-cream)] border-b border-[var(--lp-ink)]/10">
        <div className="mx-auto flex max-w-[1100px] items-center justify-end gap-4 px-5 py-2 text-[0.78rem] sm:px-8">
          <span className="lp-sans text-[var(--lp-ink)]/60">Already a buyer?</span>
          <Link
            href="/wholesale/status"
            className="lp-sans font-bold text-[var(--lp-ink)] hover:text-[var(--lp-red)]"
          >
            Check order status →
          </Link>
        </div>
      </div>

      <PageHero
        eyebrow="For Distributors, Retailers, and Bulk Buyers"
        headline="Wholesale"
        scriptAccent="USA Gummies."
        sub="Pricing, MOQs, and lead times sent within one business day. Master cartons (36 bags) and pallet quantities — landed or buyer-paid freight."
      />

      {/* Form is the primary CTA — no anchor-scroll, no buried-below-marketing-copy. */}
      <section className="bg-[var(--lp-cream)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[680px] px-5 py-12 sm:px-8 sm:py-16">
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={{ boxShadow: "6px 6px 0 var(--lp-red)" }}
          >
            <WholesaleForm />
          </div>
          <p className="lp-sans mt-4 text-center text-[0.85rem] text-[var(--lp-ink)]/65">
            Pricing, MOQs, and lead times sent to your inbox within one business day.
          </p>
        </div>
      </section>

      {/* Value pitch lives BELOW the form, not above. Anyone scrolling past
          the form is reading for context — they're past the conversion point. */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <div className="text-center">
            <p className="lp-label text-[var(--lp-red)]">★ Why USA Gummies ★</p>
            <h2 className="lp-display mt-3 text-[clamp(1.8rem,4.5vw,2.6rem)] leading-tight text-[var(--lp-ink)]">
              Built for retail partners who want
              <br />
              <span className="lp-script text-[var(--lp-red)]">clean credibility.</span>
            </h2>
          </div>

          <ul className="lp-sans mx-auto mt-8 grid max-w-[820px] gap-3 text-[1rem] text-[var(--lp-ink)]/88 sm:grid-cols-2">
            {VALUE_BULLETS.map((bullet) => (
              <li
                key={bullet}
                className="flex gap-3 border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4"
              >
                <span className="text-[var(--lp-red)]">★</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
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
      </section>
    </main>
  );
}
