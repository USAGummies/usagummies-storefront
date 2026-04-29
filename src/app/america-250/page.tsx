// /america-250 — America's 250th hub page in LP design language. Structure:
// PageHero → ScarcityBar → Sub-hub grid (gifts/celebrations/events) →
// Featured bundle pitch → Pillar context (brand + quick links) → Evergreen +
// Event ideas grid → Search-intent block → FAQ accordion → ThreePromises →
// GuaranteeBlock → bottom CTA. BlogPosting + FAQPage + Breadcrumb JSON-LD
// preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { BlogPostingJsonLd } from "@/components/seo/BlogPostingJsonLd";

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
const PAGE_TITLE = "Americas 250th Candy | USA Gummies";
const PAGE_DESCRIPTION =
  "Americas 250th hub from USA Gummies with celebration treats, gummy gifts, and event-ready bundles.";
const PAGE_URL = `${SITE_URL}/america-250`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;
const PUBLISHED_DATE = "2026-01-01T15:10:31-08:00";
const MODIFIED_DATE = "2026-02-05T22:32:05-08:00";

const SUBHUBS = [
  {
    href: "/america-250/gifts",
    title: "Gifts",
    body: "Patriotic gummy gift ideas and bag options.",
  },
  {
    href: "/america-250/celebrations",
    title: "Celebrations",
    body: "Party ideas, parade snacks, and shareable bag options.",
  },
  {
    href: "/america-250/events",
    title: "Events",
    body: "Bundle sizes for parades, town squares, and community moments.",
  },
];

const EVERGREEN = [
  {
    label: "Gummy gift bundles",
    href: "/gummy-gift-bundles",
    note: "Gift-forward bag-count picks for birthdays and team gifting.",
  },
  {
    label: "Made-in-USA candy",
    href: "/made-in-usa",
    note: "USA-made favorites with the standard ingredient story.",
  },
  {
    label: "Bulk gummy bears",
    href: "/bulk-gummy-bears",
    note: "Community tables, offices, and high-volume orders.",
  },
  {
    label: "Patriotic party snacks",
    href: "/patriotic-party-snacks",
    note: "Sizing tips for July 4th and USA-themed events.",
  },
];

const EVENTS = [
  "Parades with route-day snack tables and grab-and-go candy.",
  "Fireworks nights with picnic-ready gummy assortments.",
  "School events where bagged treats keep tables stocked.",
  "Community festivals that need easy shareable sweets.",
  "Fundraisers that bundle candy for thank-you gifts.",
];

const FAQS = [
  {
    question: "What is Americas 250th candy?",
    answer:
      "Americas 250th candy refers to celebration-ready gummy assortments designed for the 250th anniversary moment and year-round gifting.",
  },
  {
    question: "Are USA Gummies products made in the USA?",
    answer:
      "Yes. We produce and pack our gummies in the United States for consistent quality and faster turnaround.",
  },
  {
    question: "Which celebrations are these bundles best for?",
    answer:
      "They are built for community gatherings, team gifting, and milestone moments where shareable bags keep tables stocked.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
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

export default function America250HubPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Americas 250th", href: "/america-250" },
        ]}
      />
      <BlogPostingJsonLd
        headline={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        url={PAGE_URL}
        image={OG_IMAGE}
        datePublished={PUBLISHED_DATE}
        dateModified={MODIFIED_DATE}
        publisherLogoUrl={`${SITE_URL}/brand/logo.png`}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="America's 250th / Hub"
        headline="Americas 250th"
        scriptAccent="candy."
        sub="Celebration treats, gifts, and event-ready gummy bundles built for the 250th anniversary moment — and shareable, USA-made gummy candy for the everyday in between."
        ctas={[
          { href: "/shop?campaign=america250#bundle-pricing", label: "Shop America's 250th" },
          { href: "/gummy-gift-bundles", label: "Gift bundles", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Sub-hubs */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Hub ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three paths
              <br />
              <span className="lp-script text-[var(--lp-red)]">to the bag.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {SUBHUBS.map((hub, i) => (
              <Link
                key={hub.href}
                href={hub.href}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7 transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.6rem] leading-tight text-[var(--lp-red)] sm:text-[1.8rem]">
                  {hub.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {hub.body}
                </p>
                <span className="lp-label mt-4 block text-[var(--lp-red)]">Explore →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured pitch */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Featured Bundle ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              America's 250th gifting,
              <br />
              <span className="lp-script text-[var(--lp-red)]">ready to share.</span>
            </h2>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <p className="lp-sans text-[1.05rem] leading-[1.7] text-[var(--lp-ink)]/85">
              Our most popular bag counts for patriotic gifts, community events, and celebration tables.
              Made in the USA. No artificial dyes.
            </p>
            <p className="lp-sans mt-3 text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
              Add <span className="font-semibold text-[var(--lp-ink)]">?campaign=america250</span> to any product page to unlock the patriotic naming.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/shop?campaign=america250#bundle-pricing" className="lp-cta">
                Shop America's 250th
              </Link>
              <Link href="/gummy-gift-bundles" className="lp-cta lp-cta-light">
                Gift bundles
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pillar — brand + quick links */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Pillar ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              America's 250th candy
              <br />
              <span className="lp-script text-[var(--lp-red)]">for patriotic celebrations.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
              style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ America's 250th Brand ★</p>
              <p className="lp-sans text-[1rem] leading-[1.65] text-[var(--lp-ink)]/85">
                USA Gummies celebrates America&rsquo;s 250th with curated gummy assortments, patriotic packaging,
                and gifting formats that work for both small gatherings and large community events.
              </p>
            </div>
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
              style={{ boxShadow: "4px 4px 0 var(--lp-ink)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Quick Links ★</p>
              <p className="lp-sans text-[1rem] leading-[1.65] text-[var(--lp-ink)]/85">
                Explore <Link href="/america-250/gifts" className="underline decoration-[var(--lp-red)] underline-offset-2">Americas 250th gifts</Link>, plan{" "}
                <Link href="/america-250/celebrations" className="underline decoration-[var(--lp-red)] underline-offset-2">patriotic celebrations</Link>, or align with{" "}
                <Link href="/america-250/events" className="underline decoration-[var(--lp-red)] underline-offset-2">Americas 250th events</Link>.
              </p>
              <p className="lp-sans mt-3 text-[1rem] leading-[1.65] text-[var(--lp-ink)]/85">
                Prefer dye-free? Read{" "}
                <Link href="/no-artificial-dyes-gummy-bears" className="underline decoration-[var(--lp-red)] underline-offset-2">Red 40 Free Gummies</Link>.
                Need a sourcing primer? See{" "}
                <Link href="/made-in-usa-candy" className="underline decoration-[var(--lp-red)] underline-offset-2">Candy Made in the USA</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Evergreen + Event lists */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Evergreen Ideas ★</p>
              <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Year-round patriotic candy moments.
              </h3>
              <p className="lp-sans mt-2 text-[0.95rem] leading-[1.6] text-[var(--lp-ink)]/82">
                Gifting, team celebrations, classroom treats, and corporate events that want an
                America's 250th theme with made-in-USA candy.
              </p>
              <ul className="mt-4 grid gap-3">
                {EVERGREEN.map((item) => (
                  <li key={item.href} className="flex items-start gap-3">
                    <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                    <span className="lp-sans text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/85">
                      <Link
                        href={item.href}
                        className="font-semibold underline decoration-[var(--lp-red)] underline-offset-2"
                      >
                        {item.label}
                      </Link>{" "}
                      — {item.note}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "4px 4px 0 var(--lp-ink)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Event-Based ★</p>
              <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Patriotic celebration treats.
              </h3>
              <p className="lp-sans mt-2 text-[0.95rem] leading-[1.6] text-[var(--lp-ink)]/82">
                Seasonal and event-driven candy moments that map naturally to America's 250th planning.
              </p>
              <ul className="mt-4 grid gap-3">
                {EVENTS.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                    <span className="lp-sans text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/85">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Search intent */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-2 text-[var(--lp-red)]">★ Search Intent, Covered ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            All the ideas
            <br />
            <span className="lp-script text-[var(--lp-red)]">in one place.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[60ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Looking for America's 250th candy ideas, patriotic celebration treats, or America's 250th gifts?
            This hub connects the most-requested ideas with USA Gummies products and planning guides.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ America's 250th FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about the moment.</span>
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((item, i) => (
              <details
                key={item.question}
                className="group border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 lp-display text-[1.05rem] leading-snug text-[var(--lp-ink)]">
                  <span>{item.question}</span>
                  <span className="text-[var(--lp-red)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <ThreePromises />
      <GuaranteeBlock />

      {/* Latest blog */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Make 250 Taste Right ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            One year,
            <br />
            <span className="lp-script text-[var(--lp-red)]">one big birthday.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop?campaign=america250#bundle-pricing" className="lp-cta">
              Shop America's 250th
            </Link>
            <Link href="/america-250/gifts" className="lp-cta lp-cta-light">
              Gift options
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
