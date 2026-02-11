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
const PAGE_TITLE = "Wholesale Dye-Free Gummies & Made in USA Candy";
const PAGE_DESCRIPTION =
  "Wholesale dye-free gummy bears for retail, corporate gifts, and events. Made in the USA, FDA-registered facility, shelf-ready packaging. Request samples or a starter case.";

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
  {
    title: "Clean ingredients",
    detail: "All natural gummy bears with no artificial dyes or synthetic colors.",
    icon: "🌿",
  },
  {
    title: "Made in the USA",
    detail: "Sourced, manufactured, and packed in FDA-registered facilities.",
    icon: "🇺🇸",
  },
  {
    title: "Retail-ready packaging",
    detail: "Patriotic branding that stands out on shelf and in gift sets.",
    icon: "🎁",
  },
  {
    title: "Five classic flavors",
    detail: "Cherry, watermelon, orange, green apple, and lemon in every 7.5 oz bag.",
    icon: "🍬",
  },
];

const PROOF_ITEMS = [
  {
    title: "Shelf-ready format",
    detail: "Clean branding, bold USA cues, and easy price-pointing for any retail environment.",
    icon: "🏪",
  },
  {
    title: "Repeat-friendly",
    detail: "Classic gummy profile built for reorders, seasonal gifting, and impulse buys.",
    icon: "🔄",
  },
  {
    title: "Reliable supply",
    detail: "USA-made production with fast fulfillment windows and consistent availability.",
    icon: "🚚",
  },
];

const USE_CASES = [
  { title: "Retail stores", detail: "Grocery, convenience, specialty, and gift shops." },
  { title: "Corporate gifting", detail: "Employee appreciation, client gifts, and branded packages." },
  { title: "Events & fundraisers", detail: "Patriotic events, school fundraisers, and team celebrations." },
  { title: "Subscription boxes", detail: "Snack boxes, care packages, and curated gift sets." },
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
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Wholesale", href: "/wholesale" },
          ]}
        />
        <JsonLd data={pageJsonLd} />

        <div className="candy-panel rounded-[36px] p-6 sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70">
                Wholesale partnerships
              </div>
              <h1 className="text-3xl font-black text-[var(--text)] sm:text-4xl lg:text-5xl leading-[1.05]">
                Bring USA Gummies to your shelves.
              </h1>
              <p className="text-base text-[var(--muted)] sm:text-lg max-w-prose leading-relaxed">
                Built for retail partners who want clean ingredients, made-in-USA credibility, and
                a bold patriotic brand story that moves product off shelves. Request a starter case
                or samples and we will follow up with wholesale terms.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {VALUE_BULLETS.map((bullet) => (
                  <div key={bullet.title} className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 transition-all duration-300 hover:shadow-[0_12px_32px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-xs">
                      <span aria-hidden="true">{bullet.icon}</span>
                    </div>
                    <div>
                      <div className="text-sm font-black text-[var(--text)]">{bullet.title}</div>
                      <div className="mt-0.5 text-xs text-[var(--muted)] leading-relaxed">{bullet.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a href="#wholesale-form" className="btn btn-candy text-base px-6 py-3.5 pressable">
                  Request starter case
                </a>
                <a href="#wholesale-form" className="btn btn-outline pressable">
                  Request the one-pager
                </a>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-3xl border border-[var(--border)] bg-white p-2.5 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)]">
                  <Image
                    src="/brand/extras/wholesale-shelf.jpg"
                    alt="USA Gummies on retail store shelf next to competitors"
                    fill
                    sizes="(max-width: 768px) 90vw, 420px"
                    className="object-cover"
                  />
                </div>
              </div>
              <div id="wholesale-form" className="scroll-mt-24">
                <div className="rounded-3xl border border-[var(--border)] bg-white p-5 sm:p-6">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70 mb-2">
                    Get started
                  </div>
                  <div className="text-lg font-black text-[var(--text)] mb-1">
                    Request wholesale info
                  </div>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Fill out the form below and we will send wholesale terms, case-pack details, and pricing within one business day.
                  </p>
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
                  <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-center">
                    <p className="text-sm text-[var(--muted)]">
                      Prefer email? Reach us directly at{" "}
                      <a href="mailto:ben@usagummies.com?subject=Wholesale%20Inquiry" className="font-bold text-[var(--text)] underline underline-offset-4 hover:text-[var(--red)] transition-colors">
                        ben@usagummies.com
                      </a>
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]/60">
                      We respond within one business day.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8 shadow-[0_18px_44px_rgba(15,27,45,0.12)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70">
              Retailer snapshot
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Wholesale-ready at a glance.
            </h2>
            <div className="mt-5 grid gap-3">
              {PROOF_ITEMS.map((item) => (
                <div key={item.title} className="group flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 transition-all duration-300 hover:shadow-[0_12px_32px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-xs">
                    <span aria-hidden="true">{item.icon}</span>
                  </div>
                  <div>
                    <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)] leading-relaxed">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 text-xs text-[var(--muted)]">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies logo"
                width={72}
                height={26}
                className="h-auto w-16 object-contain"
              />
              <span>Made in the USA &bull; All natural &bull; No artificial dyes</span>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8 shadow-[0_8px_24px_rgba(15,27,45,0.06)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70 mb-2">
                Who we work with
              </div>
              <h2 className="text-xl font-black text-[var(--text)]">
                Perfect for any channel.
              </h2>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {USE_CASES.map((item) => (
                  <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
                    <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)]">{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8 shadow-[0_8px_24px_rgba(15,27,45,0.06)]">
              <div className="text-sm font-black text-[var(--text)]">Wholesale resources</div>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                <li className="flex gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--red)]" aria-hidden="true" />
                  <span>Case-pack details and core bundle pricing</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--red)]" aria-hidden="true" />
                  <span>Ingredient and allergen overview</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--red)]" aria-hidden="true" />
                  <span>Merchandising tips and brand assets</span>
                </li>
              </ul>
              <div className="mt-4 text-xs font-semibold text-[var(--muted)]">
                Wholesale one-pager available upon request.
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6 sm:p-8 text-sm text-[var(--muted)]">
              <div className="text-sm font-black text-[var(--text)]">Need something custom?</div>
              <p className="mt-2 leading-relaxed">
                Send us your store location and preferred case quantity. We will reply with
                availability, lead times, and wholesale terms.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link href="/contact" className="btn btn-outline pressable">
                  Contact wholesale support
                </Link>
                <Link href="/faq" className="text-sm font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] transition-colors">
                  FAQ
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
