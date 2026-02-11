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
const PAGE_TITLE = "Dye-Free Gummies vs Regular Gummies — What\u2019s the Difference?";
const PAGE_DESCRIPTION =
  "Side-by-side comparison of dye-free gummies and regular gummies. Learn how ingredients, colors, taste, and safety differ so you can choose the best option for your family.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/dye-free-vs-regular-gummies` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/dye-free-vs-regular-gummies`,
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

const COMPARISON_ROWS = [
  {
    feature: "Color source",
    dyeFree: "Fruit & vegetable extracts (carrot, spirulina, turmeric, etc.)",
    regular: "Synthetic dyes (Red 40, Yellow 5, Blue 1, etc.)",
  },
  {
    feature: "FDA classification",
    dyeFree: "Exempt from batch certification — considered food-based coloring",
    regular: "Certified color additives — each batch tested by FDA",
  },
  {
    feature: "Flavor source",
    dyeFree: "Natural flavors derived from real fruit",
    regular: "Mix of artificial and natural flavors",
  },
  {
    feature: "Allergen profile",
    dyeFree: "Varies — always check the label. USA Gummies are allergen-friendly.",
    regular: "Varies — some contain wheat-based starch or dairy",
  },
  {
    feature: "Taste",
    dyeFree: "Classic gummy bear flavor — softer fruit notes, no chemical aftertaste",
    regular: "Bold, sharp fruit flavor — can have a slight chemical finish",
  },
  {
    feature: "Appearance",
    dyeFree: "Slightly muted, natural-looking colors",
    regular: "Bright, vivid neon colors",
  },
  {
    feature: "Shelf life",
    dyeFree: "Comparable — typically 12-18 months sealed",
    regular: "Comparable — typically 12-18 months sealed",
  },
  {
    feature: "Price range",
    dyeFree: "Slightly higher per oz due to ingredient sourcing",
    regular: "Lower per oz — synthetic dyes are cheaper to produce",
  },
  {
    feature: "Country of origin",
    dyeFree: "Varies by brand. USA Gummies: 100% made in the USA.",
    regular: "Often imported from China, Turkey, or Mexico",
  },
  {
    feature: "Growing demand",
    dyeFree: "Rising fast — especially among parents and health-conscious shoppers",
    regular: "Stable but declining as awareness of dye concerns grows",
  },
];

const FAQ_ITEMS = [
  {
    q: "Do dye-free gummies taste different from regular gummies?",
    a: "Most people cannot tell the difference in a blind test. Dye-free gummies use the same gelatin base and similar natural flavors. The main difference is a slightly softer color palette — the taste is virtually identical.",
  },
  {
    q: "Are dye-free gummies healthier?",
    a: "Dye-free gummies remove synthetic color additives like Red 40 and Yellow 5, which some families prefer to avoid. The calorie and sugar content is generally similar. The benefit is fewer synthetic ingredients, not necessarily fewer calories.",
  },
  {
    q: "Why are some gummies dye-free and others aren\u2019t?",
    a: "Natural colorants from fruit and vegetable extracts cost more and can be harder to work with than synthetic dyes. Many large manufacturers use synthetic dyes because they\u2019re cheaper and produce more vivid colors. Brands like USA Gummies choose natural alternatives because of growing consumer preference.",
  },
  {
    q: "What is Red 40 and why do people avoid it?",
    a: "Red 40 (Allura Red AC) is the most common synthetic food dye in the US. While FDA-approved, some parents and health advocates avoid it due to studies linking it to behavioral sensitivity in children. The UK requires a warning label on foods containing Red 40.",
  },
  {
    q: "Are dye-free gummies safe for kids?",
    a: "Yes. Dye-free gummies are safe for children and are a popular choice for parents who want to reduce their family\u2019s intake of synthetic additives. Always check the label for allergens specific to your child.",
  },
  {
    q: "How can I tell if gummies are dye-free?",
    a: "Read the ingredient list. Dye-free gummies list natural color sources like \u201cvegetable juice for color,\u201d \u201cturmeric extract,\u201d or \u201cspirulina.\u201d Regular gummies list FD&C numbers (Red 40, Yellow 5, Blue 1, etc.).",
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
  headline: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  author: { "@type": "Organization", name: "USA Gummies" },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    url: SITE_URL,
  },
  mainEntityOfPage: `${SITE_URL}/dye-free-vs-regular-gummies`,
};

export default function DyeFreeVsRegularPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 10%, rgba(76,175,80,0.10), transparent 45%), radial-gradient(circle at 75% 15%, rgba(239,59,59,0.08), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Dye-Free Candy", href: "/dye-free-candy" },
              { name: "Dye-Free vs Regular", href: "/dye-free-vs-regular-gummies" },
            ]}
          />

          {/* Hero */}
          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
              Comparison guide
            </div>
            <h1 className="mt-2 text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
              Dye-free gummies vs regular gummies
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
              What actually changes when you switch from conventional gummy bears to dye-free?
              Here&apos;s a side-by-side look at ingredients, taste, safety, and value.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                🌿 No synthetic dyes
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                🇺🇸 Made in USA options
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)]">
                👨‍👩‍👧 Family-friendly
              </span>
            </div>
          </div>

          {/* TLDR */}
          <div className="mt-6 rounded-2xl border border-[rgba(239,59,59,0.2)] bg-[rgba(239,59,59,0.04)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--candy-red)]">
              Quick summary
            </div>
            <p className="mt-2 text-sm text-[var(--text)] sm:text-base leading-relaxed">
              <strong>Dye-free gummies</strong> use natural color sources (fruit and vegetable extracts)
              instead of synthetic dyes (Red 40, Yellow 5). They taste virtually the same, look slightly
              more muted, and cost a bit more per ounce. The main reason families switch: fewer synthetic
              additives, especially for kids.
            </p>
          </div>

          {/* Comparison Table */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Head-to-head comparison
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Feature-by-feature breakdown
            </h2>

            <div className="mt-4 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-[var(--border)] pb-3 pr-4 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Feature
                    </th>
                    <th className="border-b border-[var(--border)] pb-3 px-4 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--candy-green,#22c55e)]">
                      🌿 Dye-free
                    </th>
                    <th className="border-b border-[var(--border)] pb-3 pl-4 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Regular
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={row.feature}
                      className={i % 2 === 0 ? "bg-[var(--surface-strong)]" : ""}
                    >
                      <td className="py-3 pr-4 font-semibold text-[var(--text)] whitespace-nowrap">
                        {row.feature}
                      </td>
                      <td className="py-3 px-4 text-[var(--text)]">{row.dyeFree}</td>
                      <td className="py-3 pl-4 text-[var(--muted)]">{row.regular}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Why families switch */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: "👶",
                title: "For kids",
                copy: "Many parents are choosing dye-free snacks to reduce their children\u2019s exposure to synthetic color additives.",
              },
              {
                icon: "🏷️",
                title: "Cleaner labels",
                copy: "Dye-free gummies have shorter ingredient lists with recognizable items like \u201ccarrot juice concentrate.\u201d",
              },
              {
                icon: "🌎",
                title: "Global trend",
                copy: "The EU already requires warning labels on synthetic dyes. The US market is following the same direction.",
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

          {/* USA Gummies callout */}
          <div className="mt-6 rounded-[28px] border border-[var(--border)] bg-[var(--navy)] p-6 sm:p-8 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/50">
              Our standard
            </div>
            <h2 className="mt-2 text-2xl font-black">
              USA Gummies: dye-free, made in America.
            </h2>
            <p className="mt-2 text-sm text-white/70 max-w-2xl leading-relaxed">
              Every bag of USA Gummies is colored with real fruit and vegetable extracts, flavored
              with all-natural ingredients, and manufactured in an FDA-registered facility in the
              United States. No Red 40, no Yellow 5, no artificial dyes of any kind.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">
                🇺🇸 100% Made in USA
              </span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">
                🌿 Zero synthetic dyes
              </span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">
                🏭 FDA-registered facility
              </span>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">
                📦 Free shipping on 5+ bags
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[var(--navy)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)] hover:-translate-y-0.5"
              >
                Shop dye-free gummies
              </Link>
              <Link
                href="/ingredients"
                className="text-sm font-semibold text-white/70 underline underline-offset-4 hover:text-white transition-colors"
              >
                Full ingredient list
              </Link>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Common questions
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Dye-free vs regular gummies FAQ
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
                href="/dye-free-candy"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Dye-free candy guide
              </Link>
              <Link
                href="/no-artificial-dyes-gummy-bears"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                No artificial dyes guide
              </Link>
              <Link
                href="/ingredients"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Ingredients
              </Link>
              <Link
                href="/gummy-calculator"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Gummy calculator
              </Link>
              <Link
                href="/faq"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Full FAQ
              </Link>
              <Link
                href="/shop"
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5"
              >
                Shop &amp; save
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
