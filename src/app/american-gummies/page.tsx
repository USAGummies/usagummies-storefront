import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
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
const PAGE_TITLE = "American Gummies | Made in the USA Gummy Bears | USA Gummies";
const PAGE_DESCRIPTION =
  "Classic American gummies made in the USA with zero artificial dyes. Real fruit extracts, FDA-registered facility, free shipping on 5+ bags. Shop American gummy bears and save on bundles.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/american-gummies` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/american-gummies`,
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

const FLAVORS = [
  { name: "Strawberry", color: "rgba(239,59,59,0.12)", accent: "var(--candy-red, #ef3b3b)" },
  { name: "Orange", color: "rgba(249,115,22,0.12)", accent: "#f97316" },
  { name: "Lemon", color: "rgba(234,179,8,0.12)", accent: "#eab308" },
  { name: "Green Apple", color: "rgba(76,175,80,0.12)", accent: "#4caf50" },
  { name: "Pineapple", color: "rgba(253,224,71,0.14)", accent: "#facc15" },
];

const BUNDLES = [
  { bags: 5, price: "$28.02", perBag: "$5.60", note: "Free shipping" },
  { bags: 8, price: "$40.19", perBag: "$5.02", note: "Most popular" },
  { bags: 12, price: "$51.00", perBag: "$4.25", note: "Best value" },
];

const FAQ_ITEMS = [
  {
    q: "Are USA Gummies natural?",
    a: "Yes. USA Gummies are colored with real fruit and vegetable extracts like carrot, spirulina, and turmeric instead of synthetic dyes like Red 40 or Yellow 5. They use all-natural flavors derived from real fruit. No artificial colors, no artificial flavors.",
  },
  {
    q: "Where are American gummy bears made?",
    a: "USA Gummies are manufactured entirely in the United States in an FDA-registered facility. Every step of production, from mixing to packaging, takes place domestically. Many other gummy brands are imported from China, Turkey, or Mexico.",
  },
  {
    q: "What makes American gummies different from imported gummies?",
    a: "American-made gummies produced in FDA-registered facilities follow strict US manufacturing standards for food safety. USA Gummies go further by using zero artificial dyes and real fruit extracts for color and flavor, while many imported brands rely on synthetic additives to cut costs.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "American Gummies: Classic Gummy Bears Made in the USA",
  description: PAGE_DESCRIPTION,
  author: { "@type": "Organization", name: "USA Gummies" },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    url: SITE_URL,
  },
  mainEntityOfPage: `${SITE_URL}/american-gummies`,
};

export default function AmericanGummiesPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 12%, rgba(239,59,59,0.09), transparent 42%), radial-gradient(circle at 80% 8%, rgba(37,99,235,0.08), transparent 40%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "American Gummies", href: "/american-gummies" },
            ]}
          />

          {/* Hero */}
          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
              Made in the USA
            </div>
            <h1 className="mt-2 text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
              American Gummies: Classic Gummy Bears Made in the USA
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)] sm:text-base leading-relaxed">
              Not all gummy bears are created equal. USA Gummies are made entirely
              in America, in an FDA-registered facility, using real fruit extracts
              for color and zero artificial dyes. These are American gummies the way
              they should be: clean ingredients, classic flavors, and quality you can
              trust.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                🇺🇸 100% Made in USA
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                🌿 Zero artificial dyes
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                🏭 FDA-registered facility
              </span>
            </div>
            <div className="mt-5">
              <Link
                href="/#bundle-pricing"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-6 py-3 text-sm font-black text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-all hover:shadow-[0_12px_32px_rgba(0,0,0,0.25)] hover:-translate-y-0.5"
              >
                Shop American Gummies
              </Link>
            </div>
          </div>

          {/* Why American-Made Matters */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Quality standards
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Why American-made matters
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] sm:text-base leading-relaxed max-w-3xl">
              Many gummy bears on store shelves are imported from overseas, where
              manufacturing standards and ingredient sourcing can vary widely.
              Choosing American gummies made in the USA means stricter oversight,
              shorter supply chains, and full transparency about what goes into
              every bag.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: "🏭",
                  title: "FDA-registered facility",
                  copy: "Our American gummy bears are produced in a facility registered with the U.S. Food and Drug Administration, following strict domestic food safety standards.",
                },
                {
                  icon: "🌿",
                  title: "No artificial dyes",
                  copy: "No Red 40, Yellow 5, or Blue 1. We use real fruit and vegetable extracts like carrot, spirulina, and turmeric for natural color.",
                },
                {
                  icon: "🍓",
                  title: "Real fruit extracts",
                  copy: "Every flavor comes from all-natural fruit-derived ingredients. Classic gummy bear taste without synthetic shortcuts.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-2xl border border-[var(--border)] bg-white p-5 transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-xl">
                    {card.icon}
                  </div>
                  <div className="mt-3 text-base font-black text-[var(--text)]">{card.title}</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">{card.copy}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Our Flavors */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Five classics
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Our flavors
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] sm:text-base leading-relaxed max-w-2xl">
              Every bag of American gummy bears includes five classic flavors, each
              made with all-natural fruit extracts and naturally derived colors.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {FLAVORS.map((flavor) => (
                <span
                  key={flavor.name}
                  className="rounded-full border px-4 py-1.5 text-sm font-semibold"
                  style={{
                    backgroundColor: flavor.color,
                    borderColor: flavor.accent,
                    color: flavor.accent,
                  }}
                >
                  {flavor.name}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Want to know exactly what goes into each gummy?{" "}
              <Link
                href="/ingredients"
                className="font-semibold underline underline-offset-2 hover:text-[var(--text)] transition-colors"
              >
                View our full ingredient list
              </Link>
              .
            </p>
          </div>

          {/* Bundle Pricing */}
          <div className="mt-6 rounded-[28px] border border-[var(--border)] bg-[var(--navy)] p-6 sm:p-8 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/50">
              Bundle &amp; save
            </div>
            <h2 className="mt-2 text-2xl font-black">
              American gummy bear bundles
            </h2>
            <p className="mt-2 text-sm text-white/70 max-w-2xl leading-relaxed">
              Save more per bag when you buy in bundles. All orders of 5+ bags
              ship free across the United States.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {BUNDLES.map((bundle) => (
                <div
                  key={bundle.bags}
                  className="rounded-2xl border border-white/15 bg-white/10 p-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/50">
                    {bundle.note}
                  </div>
                  <div className="mt-1 text-2xl font-black text-white">
                    {bundle.bags} bags
                  </div>
                  <div className="mt-1 text-lg font-bold text-white/90">
                    {bundle.price}
                  </div>
                  <div className="text-xs text-white/50">
                    {bundle.perBag} per bag
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/#bundle-pricing"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[var(--navy)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)] hover:-translate-y-0.5"
              >
                Shop American Gummies
              </Link>
              <Link
                href="/bulk-gummy-bears"
                className="text-sm font-semibold text-white/70 underline underline-offset-4 hover:text-white transition-colors"
              >
                Bulk order options
              </Link>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Common questions
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              American gummies FAQ
            </h2>
            <div className="mt-4 space-y-2">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                    <span>{item.q}</span>
                    <span className="text-[var(--muted)] transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <div className="mt-2 text-sm text-[var(--muted)]">{item.a}</div>
                </details>
              ))}
            </div>
          </div>

          {/* Cross-links */}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Keep reading
            </div>
            <h2 className="mt-2 text-lg font-black text-[var(--text)]">
              Related guides &amp; resources
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                href="/"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Shop all gummies
              </Link>
              <Link
                href="/ingredients"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Ingredients
              </Link>
              <Link
                href="/dye-free-vs-regular-gummies"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Dye-free vs regular gummies
              </Link>
              <Link
                href="/dye-free-candy"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Dye-free candy guide
              </Link>
              <Link
                href="/bulk-gummy-bears"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Bulk gummy bears
              </Link>
              <Link
                href="/faq"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Full FAQ
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <LatestFromBlog />
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </main>
  );
}
