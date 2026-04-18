import Image from "next/image";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";
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
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen pb-16">
      <div className="relative w-full h-[280px] sm:h-[340px] lg:h-[400px] overflow-hidden">
        <Image
          src="/brand/lifestyle/picnic-scene.jpg"
          alt="USA Gummies on a picnic table in an American setting"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/50 to-[#1B2A4A]/75" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <div className="relative w-44 h-20 sm:w-52 sm:h-24 mb-3">
            <Image src="/brand/logo-full.png" alt="USA Gummies" fill sizes="208px" className="object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
            Wholesale
          </h1>
          <p className="mt-2 text-sm text-white/85 max-w-md drop-shadow-sm">
            Bring America&rsquo;s favorite dye-free gummy bears to your shelves.
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-4 py-10 lg:py-12">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Wholesale", href: "/wholesale" },
          ]}
        />
        <JsonLd data={pageJsonLd} />

        <div className="candy-panel rounded-[36px] p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Wholesale USA Gummies
              </div>
              <h2 className="text-3xl font-black text-[var(--text)] sm:text-4xl">
                Request wholesale pricing.
              </h2>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Built for retail partners who want clean ingredients, made-in-USA
                credibility, and a bold patriotic brand story. Tell us a little
                about your business and we&rsquo;ll send wholesale pricing,
                MOQs, and lead times within one business day.
              </p>

              <ul className="grid gap-2 text-sm text-[var(--text)]">
                {VALUE_BULLETS.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[var(--red)]" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-[0_18px_44px_rgba(15,27,45,0.08)]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Retailer snapshot
                </div>
                <div className="mt-2 text-base font-black text-[var(--text)]">
                  Wholesale-ready at a glance
                </div>
                <div className="mt-3 grid gap-2">
                  {PROOF_ITEMS.map((item) => (
                    <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
                      <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                      <div className="text-xs text-[var(--muted)]">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div id="wholesale-form" className="lg:sticky lg:top-6">
              <WholesaleForm />
              <p className="mt-3 text-center text-xs text-[var(--muted)]">
                Pricing, MOQs, and lead times sent to your inbox within one business day.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
