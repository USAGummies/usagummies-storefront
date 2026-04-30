import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/JsonLd";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { US_MAP_SVG } from "@/lib/marketing/us-map-svg";
import { WholesaleForm } from "./WholesaleForm";

const TOP_REVIEWS = AMAZON_REVIEWS.reviews.slice(0, 3);

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

      {/* Logo-led hero — brand identity first, "Wholesale" as the role label
          underneath. No more typography-only blocks. */}
      <section className="relative overflow-hidden bg-[var(--lp-cream)]">
        <div className="lp-bunting" aria-hidden />
        <div className="relative mx-auto max-w-[1100px] px-5 py-12 text-center sm:px-8 sm:py-16">
          <Image
            src="/brand/logo-full.png"
            alt="USA Gummies"
            width={1118}
            height={645}
            priority
            sizes="(max-width: 640px) 220px, 320px"
            className="mx-auto h-auto w-[220px] sm:w-[280px] lg:w-[320px]"
          />
          <p className="lp-label mt-6 text-[var(--lp-red)]">★ For Distributors, Retailers &amp; Bulk Buyers ★</p>
          <h1 className="lp-display mt-3 text-[clamp(3rem,8vw,5.5rem)] leading-[0.95] text-[var(--lp-ink)]">
            Wholesale.
          </h1>
          <p className="lp-sans mx-auto mt-5 max-w-[54ch] text-[1.05rem] leading-[1.55] text-[var(--lp-ink)]/85">
            Master cartons (36 bags), pallet quantities, and custom programs — landed or buyer-paid freight.
            Pricing &amp; MOQs returned within one business day.
          </p>
        </div>
        <div className="lp-bunting-thin" aria-hidden />
      </section>

      {/* Product hero band — give buyers a clean look at the bag and what's
          inside before they fill out a form. */}
      <section className="bg-[var(--lp-off-white)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="grid grid-cols-1 items-center gap-8 sm:grid-cols-2 sm:gap-10">
            <div className="relative aspect-[4/3] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-cream-soft)]"
                 style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}>
              <Image
                src="/brand/photos/bag-1776.jpg"
                alt="USA Gummies — All American Gummy Bears, 7.5 oz bag"
                fill
                sizes="(max-width: 640px) 90vw, 540px"
                className="object-cover"
              />
            </div>
            <div>
              <p className="lp-label text-[var(--lp-red)]">★ The Product ★</p>
              <h2 className="lp-display mt-3 text-[clamp(1.7rem,4vw,2.4rem)] leading-tight text-[var(--lp-ink)]">
                7.5 oz bag.
                <br />
                <span className="lp-script text-[var(--lp-red)]">Five fruit flavors.</span>
              </h2>
              <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/80">
                Classic gummy bear shape. Made with real fruit juice. No artificial dyes, no high-fructose corn syrup,
                no synthetic flavors. Patriotic packaging built to stand out on a shelf or in a gift set.
              </p>
              <div className="mt-6 grid grid-cols-5 gap-2">
                {[
                  { color: "red", label: "Cherry" },
                  { color: "orange", label: "Orange" },
                  { color: "yellow", label: "Lemon" },
                  { color: "green", label: "Apple" },
                  { color: "pink", label: "Strawberry" },
                ].map((f) => (
                  <div key={f.color} className="flex flex-col items-center text-center">
                    <Image
                      src={`/brand/gummies/gummy-${f.color}.png`}
                      alt={`${f.label} gummy bear`}
                      width={400}
                      height={400}
                      sizes="80px"
                      className="h-auto w-full max-w-[64px]"
                    />
                    <span className="lp-sans mt-1 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--lp-ink)]/70">
                      {f.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

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

      {/* Supply chain visual — buyers care about provenance + transparency.
          Map of the 5 states + role detail. NO pricing leaks. */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <style>{`
          .wholesale-map { max-width: 760px; margin: 28px auto 0; padding: 0 4px; }
          .wholesale-map svg { width: 100%; height: auto; display: block; }
          .wholesale-map svg .state path { fill: #efe9dc; }
          .wholesale-map svg .borders { stroke: #d6d0c3; stroke-width: 0.75; }
          .wholesale-map svg .dccircle { display: none; }
          .wholesale-map svg path.in,
          .wholesale-map svg path.wi,
          .wholesale-map svg path.wa,
          .wholesale-map svg path.wy,
          .wholesale-map svg path.pa { fill: var(--lp-red); }
        `}</style>
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <div className="text-center">
            <p className="lp-label text-[var(--lp-red)]">★ Across America ★</p>
            <h2 className="lp-display mt-3 text-[clamp(1.8rem,4.5vw,2.6rem)] leading-tight text-[var(--lp-ink)]">
              Six locations.
              <br />
              <span className="lp-script text-[var(--lp-red)]">Five states.</span>
            </h2>
            <p className="lp-sans mt-3 text-[0.95rem] text-[var(--lp-ink)]/75">
              From sea to shining sea. Most &ldquo;Made in USA&rdquo; brands won&rsquo;t tell you which states. We will.
            </p>
          </div>
          <div className="wholesale-map" dangerouslySetInnerHTML={{ __html: US_MAP_SVG }} aria-hidden="true" />

          {/* Single condensed legend — five role chips inline. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.85rem]">
            {[
              { state: "IN", role: "Gummies crafted" },
              { state: "WI", role: "Packaging" },
              { state: "WA", role: "West Coast warehouse" },
              { state: "PA", role: "East Coast warehouse" },
              { state: "WY", role: "Corporate" },
            ].map((chip) => (
              <div key={chip.state} className="flex items-center gap-2">
                <span
                  className="inline-flex h-7 w-7 items-center justify-center border-2 border-[var(--lp-ink)] bg-[var(--lp-red)] text-[0.7rem] font-bold text-white"
                  aria-hidden
                >
                  {chip.state}
                </span>
                <span className="lp-sans text-[var(--lp-ink)]/80">{chip.role}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Visual stats band — three big numbers, no paragraphs. */}
      <section className="bg-[var(--lp-red)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
          <div className="grid grid-cols-1 gap-6 text-center text-white sm:grid-cols-3 sm:gap-4">
            <div>
              <div className="lp-display text-[clamp(2.6rem,6vw,3.6rem)] leading-none">
                {AMAZON_REVIEWS.aggregate.rating.toFixed(1)}★
              </div>
              <div className="lp-label mt-2 text-white/85">Avg. customer rating</div>
            </div>
            <div className="border-l-0 border-r-0 sm:border-l-2 sm:border-r-2 sm:border-white/30 sm:px-4">
              <div className="lp-display text-[clamp(2.6rem,6vw,3.6rem)] leading-none">36</div>
              <div className="lp-label mt-2 text-white/85">Bags / master carton</div>
            </div>
            <div>
              <div className="lp-display text-[clamp(2.6rem,6vw,3.6rem)] leading-none">5</div>
              <div className="lp-label mt-2 text-white/85">States in our supply chain</div>
            </div>
          </div>
        </div>
      </section>

      {/* Real customer reviews — Cialdini social proof for retail buyers. */}
      <section className="bg-[var(--lp-off-white)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <div className="text-center">
            <p className="lp-label text-[var(--lp-red)]">★ What customers say ★</p>
            <h2 className="lp-display mt-3 text-[clamp(1.8rem,4.5vw,2.6rem)] leading-tight text-[var(--lp-ink)]">
              {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} from {AMAZON_REVIEWS.aggregate.count} real reviews.
            </h2>
            <p className="lp-sans mt-3 text-[0.95rem] text-[var(--lp-ink)]/75">
              Mix of verified buyers and Amazon Vine reviewers. We don&rsquo;t hide the critical ones.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-[1000px] mx-auto">
            {TOP_REVIEWS.map((r) => (
              <div key={r.id} className="border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] p-5">
                <div className="text-[var(--lp-red)] text-[0.95rem]">{"★".repeat(r.rating)}</div>
                <div className="lp-display mt-2 text-[1rem] text-[var(--lp-ink)] leading-tight">
                  &ldquo;{r.title}&rdquo;
                </div>
                <p className="lp-sans mt-2 text-[0.85rem] text-[var(--lp-ink)]/80 leading-relaxed">
                  {r.body.length > 140 ? r.body.slice(0, 140) + "…" : r.body}
                </p>
                <div className="mt-3 flex items-center justify-between text-[0.75rem]">
                  <span className="lp-sans text-[var(--lp-ink)]/60 font-semibold">&mdash; {r.authorName}</span>
                  <span className={`lp-sans font-semibold ${r.program === "vine" ? "text-[var(--lp-ink)]/60" : "text-[var(--lp-red)]"}`}>
                    {r.program === "vine" ? "Amazon Vine" : "✓ Verified buyer"}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
