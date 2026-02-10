import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";

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
const PAGE_TITLE = "Wholesale Candy | USA Gummies";
const PAGE_DESCRIPTION =
  "Wholesale made in USA candy and dye-free gummies for retailers, teams, and events. No artificial dyes, easy ordering.";

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
  "All natural gummy bears with no artificial dyes.",
  "Made in the USA and packed in FDA-registered facilities.",
  "7.5 oz bags with classic gummy bear flavor and five fruit flavors.",
  "Patriotic packaging that stands out on shelf and in gift sets.",
];

const PROOF_ITEMS = [
  {
    title: "Shelf-ready format",
    detail: "Clean branding, bold USA cues, and easy price‑pointing.",
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
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen pb-16">
      <section className="site-container py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Wholesale", href: "/wholesale" },
          ]}
        />
        <JsonLd data={pageJsonLd} />

        <div className="candy-panel rounded-[36px] p-6 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Wholesale USA Gummies
              </div>
              <h1 className="text-3xl font-black text-[var(--text)] sm:text-4xl">
                Bring USA Gummies to your shelves.
              </h1>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Built for retail partners who want clean ingredients, made‑in‑USA credibility, and
                a bold patriotic brand story. Request a starter case or samples and we will follow up
                with wholesale terms.
              </p>

              <ul className="grid gap-2 text-sm text-[var(--text)]">
                {VALUE_BULLETS.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[var(--red)]" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a href="#wholesale-form" className="btn btn-candy pressable">
                  Request starter case
                </a>
                <a href="#wholesale-form" className="btn btn-outline pressable">
                  Request the one‑pager
                </a>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                  <Image
                    src="/brand/usa-gummies-family.webp"
                    alt="Assorted USA Gummies gummy bear bags"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-contain"
                  />
                </div>
              </div>
              <div id="wholesale-form">
                <Script
                  src="https://js-na2.hsforms.net/forms/embed/245038506.js"
                  strategy="afterInteractive"
                />
                <div
                  className="hs-form-frame"
                  data-region="na2"
                  data-form-id="22ab9284-ad89-4deb-b2ad-b6d6dc585cb1"
                  data-portal-id="245038506"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Retailer snapshot
            </div>
            <div className="mt-2 text-xl font-black text-[var(--text)]">
              Wholesale-ready at a glance
            </div>
            <div className="mt-4 grid gap-3">
              {PROOF_ITEMS.map((item) => (
                <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
                  <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                  <div className="text-xs text-[var(--muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3 text-xs text-[var(--muted)]">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies logo"
                width={72}
                height={26}
                className="h-auto w-16 object-contain"
              />
              <span>Made in the USA • All natural • No artificial dyes</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-3xl border border-[var(--border)] bg-white p-5">
              <div className="text-sm font-black text-[var(--text)]">Wholesale resources</div>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <li>• Case‑pack details and core bundle pricing</li>
                <li>• Ingredient and allergen overview</li>
                <li>• Merchandising tips + brand assets</li>
              </ul>
              <div className="mt-4 text-xs font-semibold text-[var(--muted)]">
                Wholesale one‑pager available upon request.
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 text-sm text-[var(--muted)]">
              <div className="text-sm font-black text-[var(--text)]">Need something custom?</div>
              <p className="mt-2">
                Send us your store location and preferred case quantity. We will reply with
                availability, lead times, and wholesale terms.
              </p>
              <Link href="/contact" className="mt-3 inline-flex text-sm font-semibold text-[var(--navy)] underline underline-offset-4">
                Contact wholesale support
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
