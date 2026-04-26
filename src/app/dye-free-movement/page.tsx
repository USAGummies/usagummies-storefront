// /dye-free-movement — long-form historical timeline page in LP design
// language. Structure: PageHero → ScarcityBar → Key stats grid → Timeline
// (15-entry vertical narrative, preserved fully) → "Who Led, Who Followed"
// brand list → SustainabilityBlock → LeadCapture (preserved client component)
// → GuaranteeBlock → bottom CTA.
// Article + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { LeadCapture } from "@/components/marketing/LeadCapture.client";

const SITE_URL = "https://www.usagummies.com";

export const metadata: Metadata = {
  title: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
  description:
    "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy. See which brands led and which followed.",
  alternates: { canonical: `${SITE_URL}/dye-free-movement` },
  keywords: [
    "dye free candy timeline",
    "artificial dye ban history",
    "Red No 3 ban",
    "food dye removal candy",
    "dye free candy brands",
    "natural color candy",
    "Red 40 free candy",
    "candy without artificial dyes",
    "Mars removing dyes",
    "FDA food dye ban 2025",
  ],
  openGraph: {
    title: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
    description:
      "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy.",
    url: `${SITE_URL}/dye-free-movement`,
    siteName: "USA Gummies",
    type: "article",
    images: [{ url: "/opengraph-image", alt: "Dye-Free Movement Timeline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Dye-Free Movement — Timeline of Candy Without Artificial Colors",
    description:
      "From EU warning labels to the FDA Red No. 3 ban — see which candy brands led the dye-free shift and which are still catching up.",
    images: ["/opengraph-image"],
  },
};

type TimelineCategory = "regulation" | "industry" | "usa-gummies" | "science";

const TIMELINE: {
  year: string;
  title: string;
  description: string;
  category: TimelineCategory;
}[] = [
  {
    year: "2007",
    title: "UK Study Links Dyes to Hyperactivity",
    description:
      "A University of Southampton study funded by the UK Food Standards Agency finds that mixtures of artificial food dyes and sodium benzoate may increase hyperactive behavior in children. The study is published in The Lancet.",
    category: "science",
  },
  {
    year: "2010",
    title: "EU Requires Warning Labels on Dyed Foods",
    description:
      'The European Union begins requiring foods containing six artificial dyes to carry labels warning they "may have an adverse effect on activity and attention in children." Many manufacturers reformulate rather than add the warning.',
    category: "regulation",
  },
  {
    year: "2011",
    title: "FDA Reviews Dye Safety, Decides Against Warning Labels",
    description:
      "An FDA advisory panel reviews the evidence on artificial dyes and hyperactivity. The panel votes against recommending warning labels for the US market, saying available data is insufficient to establish a causal link.",
    category: "regulation",
  },
  {
    year: "2015",
    title: "Nestlé Removes Artificial Colors from Chocolate",
    description:
      "Nestlé USA announces it will remove artificial colors and flavors from all its chocolate candy products, including Butterfinger and Baby Ruth. They switch to natural alternatives like annatto and paprika.",
    category: "industry",
  },
  {
    year: "2016",
    title: "Mars Pledges to Remove Artificial Dyes Within 5 Years",
    description:
      "Mars Inc. announces plans to remove all artificial colors from its food products within five years. The company states it will use natural alternatives. The pledge is later walked back.",
    category: "industry",
  },
  {
    year: "2016",
    title: "General Mills Goes Natural on Cereal",
    description:
      "General Mills removes artificial colors and flavors from its entire cereal portfolio, including Trix and Lucky Charms. Trix temporarily loses its bright neon colors in favor of muted, naturally-derived tones.",
    category: "industry",
  },
  {
    year: "2021",
    title: "California Introduces School Dye Ban Bill",
    description:
      'California introduces legislation to ban artificial food dyes from school meals. While it doesn\'t pass initially, it signals growing state-level regulatory interest in dyes beyond the "voluntary" approach.',
    category: "regulation",
  },
  {
    year: "2023",
    title: "California Bans Red No. 3 from Food",
    description:
      "California becomes the first US state to ban Red No. 3 (erythrosine) from food products, along with three other additives. The law gives manufacturers until 2027 to comply.",
    category: "regulation",
  },
  {
    year: "2024",
    title: "USA Gummies Launches Dye-Free from Day One",
    description:
      "USA Gummies enters the market with gummy bears made without any artificial dyes, using colors from fruit and vegetable extracts, spirulina, and turmeric. All products are manufactured in the United States.",
    category: "usa-gummies",
  },
  {
    year: "2025",
    title: "FDA Bans Red No. 3 Nationwide",
    description:
      "The FDA officially bans Red No. 3 from food products across the United States, with full removal required by January 2027. The agency also encourages industry to phase out Red No. 40.",
    category: "regulation",
  },
  {
    year: "2025",
    title: "FDA Approves Three Natural Color Additives",
    description:
      "In May 2025, the FDA approves three new color additives from natural sources, giving food manufacturers more options for replacing synthetic dyes with plant-derived alternatives.",
    category: "regulation",
  },
  {
    year: "2025",
    title: 'RFK Jr. Launches "Make America Healthy Again"',
    description:
      "Health and Human Services Secretary Robert F. Kennedy Jr. pushes to crack down on synthetic food additives, including proposals to phase out artificial food dyes in favor of natural alternatives.",
    category: "regulation",
  },
  {
    year: "2025",
    title: "Kraft Heinz and General Mills Announce Dye Removal",
    description:
      "In June 2025, Kraft Heinz and General Mills announce plans to remove artificial food dyes from some products within two years. Other major food companies follow with similar announcements.",
    category: "industry",
  },
  {
    year: "2025",
    title: "Mars Announces Dye-Free Options for 2026",
    description:
      "Mars Wrigley announces it will offer M&M's, Skittles, Starburst, and Extra Gum without synthetic dyes starting in 2026. These are additional options — existing dyed versions remain available.",
    category: "industry",
  },
  {
    year: "2025",
    title: "Industry-Wide Shift Accelerates",
    description:
      "PepsiCo, ConAgra, The Hershey Company, McCormick, J.M. Smucker, and Nestlé USA all announce plans to reduce or eliminate artificial dyes. The shift that started in Europe 15 years earlier reaches critical mass in the US.",
    category: "industry",
  },
];

const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  regulation: "Regulation",
  industry: "Industry",
  "usa-gummies": "USA Gummies",
  science: "Research",
};

const KEY_STATS = [
  { stat: "2007", label: "First major study on dyes & hyperactivity" },
  { stat: "2010", label: "EU requires warning labels" },
  { stat: "2025", label: "FDA bans Red No. 3" },
  { stat: "8+", label: "Major US brands now removing dyes" },
];

const BRANDS_TIMELINE = [
  { name: "Nestlé USA", year: 2015, note: "Removed from chocolate candy" },
  { name: "General Mills", year: 2016, note: "Removed from cereals" },
  { name: "USA Gummies", year: 2024, note: "Launched dye-free from day one", highlight: true },
  { name: "Kraft Heinz", year: 2025, note: "Announced removal plans" },
  { name: "General Mills", year: 2025, note: "Announced candy removal plans" },
  { name: "PepsiCo", year: 2025, note: "Announced removal plans" },
  { name: "Hershey", year: 2025, note: "Announced removal plans" },
  { name: "Mars Wrigley", year: 2026, note: "Dye-free options (not full removal)" },
];

const jsonLdArticle = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
  description:
    "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy.",
  url: `${SITE_URL}/dye-free-movement`,
  image: `${SITE_URL}/opengraph-image`,
  datePublished: "2026-02-15",
  dateModified: "2026-02-15",
  author: { "@type": "Organization", name: "USA Gummies", url: SITE_URL },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/logo.png` },
  },
  mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/dye-free-movement` },
};

const jsonLdBreadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Dye-Free Candy", item: `${SITE_URL}/dye-free-candy` },
    { "@type": "ListItem", position: 3, name: "The Dye-Free Movement", item: `${SITE_URL}/dye-free-movement` },
  ],
};

export default function DyeFreeMovementPage() {
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdArticle) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }}
      />

      <PageHero
        eyebrow="The Dye-Free Movement"
        headline="From neon"
        scriptAccent="to natural."
        sub="The timeline of artificial dye removal from candy — from the first European warning labels to the biggest US brands announcing reformulations. See who led and who followed."
        ctas={[
          { href: "/shop", label: "Shop USA Gummies", variant: "primary" },
          { href: "/vs", label: "Brand comparisons", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Key stats */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ At a Glance ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Eighteen years
              <br />
              <span className="lp-script text-[var(--lp-red)]">in numbers.</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {KEY_STATS.map((item, i) => (
              <div
                key={item.label}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 text-center"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <div className="lp-display text-[2rem] leading-none text-[var(--lp-red)] sm:text-[2.4rem]">
                  {item.stat}
                </div>
                <p className="lp-sans mt-3 text-[0.85rem] leading-[1.4] text-[var(--lp-ink)]/82">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Timeline ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              The shift,
              <br />
              <span className="lp-script text-[var(--lp-red)]">step by step.</span>
            </h2>
          </div>

          <div className="grid gap-5">
            {TIMELINE.map((entry, i) => {
              const isUg = entry.category === "usa-gummies";
              return (
                <div
                  key={`${entry.year}-${i}`}
                  className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                  style={{ boxShadow: isUg ? "5px 5px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="lp-display text-[1.6rem] leading-none text-[var(--lp-red)]">
                      {entry.year}
                    </span>
                    <span
                      className="lp-label border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-3 py-1 text-[var(--lp-ink)]"
                    >
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                  </div>
                  <h3 className="lp-display mt-3 text-[1.25rem] leading-tight text-[var(--lp-ink)] sm:text-[1.4rem]">
                    {entry.title}
                  </h3>
                  <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                    {entry.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Who led, who followed */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Roll Call ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Who led.
              <br />
              <span className="lp-script text-[var(--lp-red)]">Who followed.</span>
            </h2>
            <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
              When each brand acted on removing artificial dyes from candy.
            </p>
          </div>

          <div className="grid gap-3">
            {BRANDS_TIMELINE.map((brand) => (
              <div
                key={`${brand.name}-${brand.year}`}
                className="flex flex-wrap items-center justify-between gap-4 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                style={{ boxShadow: brand.highlight ? "5px 5px 0 var(--lp-red)" : "3px 3px 0 var(--lp-ink)" }}
              >
                <div className="flex items-center gap-4">
                  <span className="lp-display min-w-[3.5rem] text-[1.6rem] leading-none text-[var(--lp-red)]">
                    {brand.year}
                  </span>
                  <div>
                    <div className="lp-display text-[1.1rem] text-[var(--lp-ink)]">{brand.name}</div>
                    <div className="lp-sans text-[0.9rem] leading-[1.4] text-[var(--lp-ink)]/75">
                      {brand.note}
                    </div>
                  </div>
                </div>
                {brand.highlight ? (
                  <span
                    className="lp-label border-2 border-[var(--lp-red)] bg-[var(--lp-cream-soft)] px-3 py-1 text-[var(--lp-red)]"
                  >
                    ★ Day One
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <SustainabilityBlock />

      {/* Email capture — preserves LeadCapture client component */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-20">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Stay in the Loop ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Stay ahead of
            <br />
            <span className="lp-script text-[var(--lp-red)]">the movement.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Get ingredient news, label-reading tips, and first access to new USA Gummies flavors.
            No spam — just the stuff that matters.
          </p>
          <div
            className="mx-auto mt-8 max-w-[480px] border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <LeadCapture
              source="dye-free-movement"
              intent="newsletter"
              title=""
              ctaLabel="Join the movement"
              variant="light"
              emphasis="quiet"
              showSms={false}
            />
          </div>
        </div>
      </section>

      <GuaranteeBlock />

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Don&rsquo;t Wait for 2027 ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Already
            <br />
            <span className="lp-script text-[var(--lp-red)]">dye-free.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            While the big brands are still announcing plans, USA Gummies has been dye-free since
            launch. All natural flavors, no artificial dyes, made in the USA.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/vs" className="lp-cta lp-cta-light">
              View brand comparisons
            </Link>
          </div>
          <p className="lp-sans mx-auto mt-8 max-w-[60ch] text-[0.85rem] leading-[1.5] text-[var(--lp-ink)]/65">
            Timeline events sourced from FDA announcements, news reports, and company press releases.
            All dates and facts are from publicly available information.
          </p>
        </div>
      </section>
    </main>
  );
}
