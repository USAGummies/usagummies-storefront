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

const PROOF_ITEMS = [
  {
    title: "Shelf-ready format",
    detail: "Clean branding, bold USA cues, easy price-pointing.",
  },
  {
    title: "Repeat-friendly",
    detail: "Classic gummy profile built for reorders and seasonal gifting.",
  },
  {
    title: "Reliable supply",
    detail: "USA-made production with fast fulfillment windows.",
  },
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

      <PageHero
        eyebrow="For Buyers"
        headline="Wholesale"
        scriptAccent="USA Gummies."
        sub="Bring America's favorite dye-free gummy bears to your shelves. Pricing, MOQs, and lead times sent within one business day."
        ctas={[
          { href: "#wholesale-form", label: "Request pricing" },
          { href: "/where-to-buy", label: "Find us in stores", variant: "light" },
        ]}
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-6">
              <p className="lp-label text-[var(--lp-red)]">★ Wholesale Snapshot ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] leading-tight text-[var(--lp-ink)]">
                Request wholesale
                <br />
                <span className="lp-script text-[var(--lp-red)]">pricing.</span>
              </h2>
              <p className="lp-sans text-[1.05rem] leading-[1.7] text-[var(--lp-ink)]/85">
                Built for retail partners who want clean ingredients, made-in-USA credibility, and a
                bold patriotic brand story. Tell us about your business and we&rsquo;ll send wholesale
                pricing, MOQs, and lead times within one business day.
              </p>

              <ul className="lp-sans space-y-3 text-[1rem] text-[var(--lp-ink)]/88">
                {VALUE_BULLETS.map((bullet) => (
                  <li key={bullet} className="flex gap-3">
                    <span className="text-[var(--lp-red)]">★</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
              >
                <p className="lp-label mb-3 text-[var(--lp-red)]">★ Retailer Snapshot ★</p>
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)]">
                  Wholesale-ready at a glance
                </h3>
                <div className="mt-4 grid gap-3">
                  {PROOF_ITEMS.map((item) => (
                    <div
                      key={item.title}
                      className="border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] p-4"
                    >
                      <div className="lp-display text-[1.05rem] text-[var(--lp-ink)]">{item.title}</div>
                      <div className="lp-sans mt-1 text-[0.92rem] leading-[1.5] text-[var(--lp-ink)]/75">
                        {item.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div id="wholesale-form" className="lg:sticky lg:top-6">
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
              >
                <WholesaleForm />
              </div>
              <p className="lp-sans mt-4 text-center text-[0.85rem] text-[var(--lp-ink)]/70">
                Pricing, MOQs, and lead times sent to your inbox within one business day.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Already a Buyer? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Check your
            <br />
            <span className="lp-script text-[var(--lp-red)]">order status.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/wholesale/status" className="lp-cta">
              Order status
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
      </section>
    </main>
  );
}
