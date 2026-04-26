// /ingredients — full ingredients + nutrition page in LP design language.
// Structure: PageHero → ScarcityBar → Ingredient list + Nutrition Facts
// (preserved structured table) → Quality points → Flavor lineup → BagSlider
// (interactive client component preserved) → Competitor comparison table
// (preserved table markup) → FAQ → GuaranteeBlock → bottom CTA.
// Article + FAQ JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import BagSlider from "@/components/purchase/BagSlider.client";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
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
const PAGE_TITLE = "Ingredients: No Artificial Dyes";
const PAGE_DESCRIPTION =
  "See what's inside our dye-free gummies and made in USA candy, plus the flavors and ingredients we avoid.";
const ARTICLE_HEADLINE = "Ingredients and nutrition facts for USA Gummies";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/ingredients` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/ingredients`,
    type: "website",
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
  {
    name: "Cherry",
    notes: "Bright, classic cherry with a clean, fruit-forward finish.",
    image: "/brand/gummies/gummy-pink.png",
  },
  {
    name: "Watermelon",
    notes: "Smooth and refreshing, a light summer watermelon note.",
    image: "/brand/gummies/gummy-red.png",
  },
  {
    name: "Orange",
    notes: "Citrus pop with a sweet, familiar orange flavor.",
    image: "/brand/gummies/gummy-orange.png",
  },
  {
    name: "Green apple",
    notes: "Crisp green apple with a balanced sweet-tart bite.",
    image: "/brand/gummies/gummy-green.png",
  },
  {
    name: "Lemon",
    notes: "Zesty lemon lift that keeps the chew bright and clean.",
    image: "/brand/gummies/gummy-yellow.png",
  },
];

const INGREDIENTS_LIST = [
  "Corn syrup",
  "Sugar",
  "Water",
  "Gelatin",
  "Citric acid",
  "Natural flavor",
  "Pectin",
  "Colors (from fruits, vegetables, spirulina, and curcumin)",
  "Vegetable oil (coconut, canola)",
  "Carnauba leaf wax (to prevent sticking)",
];

type NutritionRow = {
  label: string;
  amount?: string;
  dv?: string;
  indent?: 0 | 1 | 2;
  strong?: boolean;
};

const SERVINGS_PER_CONTAINER = "7";
const SERVING_SIZE = "9 pieces (32g)";
const CALORIES = "100";
const NUTRITION_ROWS: NutritionRow[] = [
  { label: "Total fat", amount: "0g", dv: "0%", strong: true },
  { label: "Saturated fat", amount: "0g", dv: "0%", indent: 1 },
  { label: "Trans fat", amount: "0g", indent: 1 },
  { label: "Cholesterol", amount: "0mg", dv: "0%", strong: true },
  { label: "Sodium", amount: "15mg", dv: "1%", strong: true },
  { label: "Total carbohydrate", amount: "23g", dv: "8%", strong: true },
  { label: "Dietary fiber", amount: "0g", dv: "0%", indent: 1 },
  { label: "Total sugars", amount: "14g", indent: 1 },
  { label: "Includes added sugars", amount: "14g", dv: "28%", indent: 2 },
  { label: "Protein", amount: "1g", strong: true },
  { label: "Vitamin D", amount: "0mcg", dv: "0%" },
  { label: "Calcium", amount: "4mg", dv: "0%" },
  { label: "Iron", amount: "0mg", dv: "0%" },
  { label: "Potassium", amount: "20mg", dv: "0%" },
];
const NUTRITION_FOOTNOTE =
  "*The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.";

const QUALITY_POINTS = [
  {
    title: "All natural flavors",
    body:
      "USA Gummies use all natural flavors for a classic gummy bear taste that stays smooth and balanced.",
  },
  {
    title: "No artificial dyes or synthetic colors",
    body:
      "Color comes from real fruit and vegetable extracts. No artificial dyes, no synthetic colors.",
  },
  {
    title: "Made in the USA",
    body:
      "Sourced, made, and packed right here in America with tight quality control at every step.",
  },
];

const FAQS = [
  {
    question: "Do USA Gummies use artificial dyes?",
    answer: "No. Colors come from fruit and vegetable extracts.",
  },
  {
    question: "What flavors are in every bag?",
    answer: "Cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "Where can I review allergen details?",
    answer: "Check the ingredient panel on the bag or visit the ingredients page.",
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

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: ARTICLE_HEADLINE,
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/ingredients`,
  },
  author: {
    "@type": "Organization",
    name: "USA Gummies",
  },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo.png`,
    },
  },
  image: [`${SITE_URL}/brand/usa-gummies-family.webp`],
};

const COMPETITORS = [
  { name: "Haribo", slug: "haribo", flag: "🇩🇪", note: "German-owned, uses Red 40 + titanium dioxide in US" },
  { name: "Trolli", slug: "trolli", flag: "🇮🇹", note: "Italian-owned, made in Mexico, artificial colors" },
  { name: "Sour Patch Kids", slug: "sour-patch-kids", flag: "🇨🇦", note: "Made in Canada/Mexico, artificial colors" },
  { name: "Skittles Gummies", slug: "skittles-gummies", flag: "🇺🇸", note: "Promised to remove dyes in 2016 — still uses them" },
];

export default function IngredientsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Ingredients", href: "/ingredients" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <PageHero
        eyebrow="Ingredients & Nutrition"
        headline="What's"
        scriptAccent="in the bag."
        sub="Real fruit extracts, no artificial dyes. The full ingredient list and nutrition facts for our 7.5 oz bag of All American gummy bears."
        ctas={[
          { href: "/shop", label: "Shop now", variant: "primary" },
          { href: "/no-artificial-dyes-gummy-bears", label: "Dye-free guide", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Real ingredients, real colors — macro proof shot. The
       * raspberries + beets next to the bag set up the ingredient
       * panel below as honest, not abstract. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <figure
              className="relative overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
              <div className="relative aspect-square w-full">
                <Image
                  src="/brand/ad-assets-round2/photo-ingredient-macro.png"
                  alt="A bag of USA Gummies next to a bowl of raspberries, fresh beets, and a plate of dye-free gummy bears"
                  fill
                  sizes="(max-width: 1024px) 88vw, 560px"
                  className="object-cover"
                  priority
                />
              </div>
            </figure>

            <div>
              <p className="lp-label mb-3 text-[var(--lp-red)]">★ Real Color, Real Fruit ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] leading-[1] text-[var(--lp-ink)]">
                Color comes
                <br />
                <span className="lp-script text-[var(--lp-red)]">from food.</span>
              </h2>
              <p className="lp-sans mt-5 text-[1.1rem] leading-[1.6] text-[var(--lp-ink)]/85">
                The reds come from beets and raspberries. The yellows come
                from curcumin (turmeric). The greens come from spirulina.
                Every shade in the bag is something you could find on a
                farmer&rsquo;s table.
              </p>
              <p className="lp-sans mt-3 text-[1rem] leading-[1.55] text-[var(--lp-ink)]/75">
                Not one petroleum-derived dye on the panel. The full
                ingredient list is right below, exactly as printed on the
                bag.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Ingredients list + Nutrition Facts (structured table preserved) */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Ingredient Panel ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Read the bag,
              <br />
              <span className="lp-script text-[var(--lp-red)]">honestly.</span>
            </h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            {/* Ingredient list */}
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-4 text-[var(--lp-red)]">Ingredient list</p>
              <ul className="lp-sans space-y-2 text-[1rem] leading-[1.6] text-[var(--lp-ink)]/88">
                {INGREDIENTS_LIST.map((ingredient) => (
                  <li key={ingredient} className="flex items-start gap-3">
                    <span aria-hidden className="lp-star-ornament mt-[0.45em] h-3 w-3 flex-none text-[var(--lp-red)]" />
                    <span>{ingredient}</span>
                  </li>
                ))}
              </ul>
              <p className="lp-sans mt-4 text-[0.9rem] text-[var(--lp-ink)]/70">
                Contains gelatin. Ingredients listed as shown on our 7.5 oz bag.
              </p>
            </div>

            {/* Nutrition Facts panel — table structure preserved verbatim */}
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="lp-label text-[var(--lp-red)]">Nutrition facts</p>
                <span className="lp-sans text-[0.85rem] text-[var(--lp-ink)]/70">
                  {SERVINGS_PER_CONTAINER} servings per container
                </span>
              </div>
              <div className="lp-sans mt-1 text-[0.9rem] text-[var(--lp-ink)]/75">
                Serving size {SERVING_SIZE}
              </div>
              <div className="mt-3 border-y-2 border-[var(--lp-ink)] py-2">
                <div className="lp-label text-[var(--lp-ink)]/70">Amount per serving</div>
                <div className="mt-1 flex items-end justify-between">
                  <div className="lp-display text-[1.1rem] text-[var(--lp-ink)]">Calories</div>
                  <div className="lp-display text-[2.2rem] leading-none text-[var(--lp-ink)]">{CALORIES}</div>
                </div>
              </div>
              <div className="mt-2 lp-label text-right text-[var(--lp-ink)]/70">
                % Daily Value*
              </div>
              <div className="mt-2 divide-y divide-[var(--lp-ink)]/15">
                {NUTRITION_ROWS.map((row) => {
                  const indentClass =
                    row.indent === 2 ? "pl-7" : row.indent === 1 ? "pl-4" : "";
                  const labelClass = row.strong
                    ? "font-semibold text-[var(--lp-ink)]"
                    : "text-[var(--lp-ink)]/82";
                  return (
                    <div key={row.label} className="flex items-start justify-between gap-3 py-2 text-[0.9rem] sm:text-[0.95rem]">
                      <div className={`flex-1 lp-sans ${indentClass}`}>
                        <span className={labelClass}>{row.label}</span>
                        {row.amount ? <span className="ml-2 text-[var(--lp-ink)]">{row.amount}</span> : null}
                      </div>
                      <div className="lp-sans text-[var(--lp-ink)]/70">{row.dv ?? ""}</div>
                    </div>
                  );
                })}
              </div>
              <p className="lp-sans mt-3 text-[0.78rem] leading-[1.4] text-[var(--lp-ink)]/65">{NUTRITION_FOOTNOTE}</p>
            </div>
          </div>

          {/* BagSlider client component — preserved interactive component */}
          <div
            id="ingredients-buy"
            className="mt-8 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <p className="lp-label mb-4 text-center text-[var(--lp-red)]">★ Shop Bundles ★</p>
            <BagSlider variant="full" defaultQty={5} />
          </div>
        </div>
      </section>

      {/* Quality points */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Quality Standard ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three things
              <br />
              <span className="lp-script text-[var(--lp-red)]">we won&rsquo;t skip.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {QUALITY_POINTS.map((point, i) => (
              <div
                key={point.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {point.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flavor lineup */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ ★ ★ Five Natural Flavors ★ ★ ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              The full
              <br />
              <span className="lp-script text-[var(--lp-red)]">lineup.</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {FLAVORS.map((flavor) => (
              <div
                key={flavor.name}
                className="flex flex-col items-center border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 text-center"
                style={{ boxShadow: "3px 3px 0 var(--lp-ink)" }}
              >
                <div className="relative h-20 w-20 sm:h-24 sm:w-24">
                  <Image
                    src={flavor.image}
                    alt={`${flavor.name} gummy bear`}
                    fill
                    sizes="96px"
                    className="object-contain drop-shadow-[2px_3px_0_rgba(14,22,56,0.6)]"
                  />
                </div>
                <div className="lp-display mt-3 text-[1rem] text-[var(--lp-ink)]">
                  {flavor.name}
                </div>
                <p className="lp-sans mt-2 text-[0.82rem] leading-[1.4] text-[var(--lp-ink)]/75">{flavor.notes}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Competitor comparison — table markup preserved in LP wrapper */}
      <section id="vs-comparison" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ How We Compare ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Side-by-side with
              <br />
              <span className="lp-script text-[var(--lp-red)]">the competition.</span>
            </h2>
            <p className="lp-sans mx-auto mt-6 max-w-[60ch] text-[1.05rem] leading-[1.65] text-[var(--lp-ink)]/85">
              Most gummy brands use artificial dyes like Red 40, Yellow 5, and Blue 1. USA Gummies uses
              real fruit and vegetable extracts for color — no synthetic dyes, no titanium dioxide.
            </p>
          </div>

          <div className="overflow-x-auto border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]" style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)]">
                  <th className="lp-label px-4 py-3 text-[var(--lp-ink)]">Feature</th>
                  <th className="lp-label px-4 py-3 text-[var(--lp-red)]">USA Gummies</th>
                  <th className="lp-label px-4 py-3 text-[var(--lp-ink)]/70">Most competitors</th>
                </tr>
              </thead>
              <tbody className="lp-sans divide-y divide-[var(--lp-ink)]/15">
                <tr>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-ink)]">Artificial dyes</td>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-red)]">✓ None</td>
                  <td className="px-4 py-3 text-[var(--lp-ink)]/75">Red 40, Yellow 5, Blue 1</td>
                </tr>
                <tr className="bg-[var(--lp-cream-soft)]">
                  <td className="px-4 py-3 font-semibold text-[var(--lp-ink)]">Titanium dioxide</td>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-red)]">✓ None</td>
                  <td className="px-4 py-3 text-[var(--lp-ink)]/75">Present in many brands</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-ink)]">Flavors</td>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-red)]">✓ All natural</td>
                  <td className="px-4 py-3 text-[var(--lp-ink)]/75">Artificial flavors</td>
                </tr>
                <tr className="bg-[var(--lp-cream-soft)]">
                  <td className="px-4 py-3 font-semibold text-[var(--lp-ink)]">Made in USA</td>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-red)]">✓ Sourced, made &amp; packed</td>
                  <td className="px-4 py-3 text-[var(--lp-ink)]/75">Germany, Mexico, Turkey, etc.</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-ink)]">Color source</td>
                  <td className="px-4 py-3 font-semibold text-[var(--lp-red)]">✓ Fruit &amp; vegetable extracts</td>
                  <td className="px-4 py-3 text-[var(--lp-ink)]/75">Petroleum-derived dyes</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COMPETITORS.map((comp) => (
              <Link
                key={comp.slug}
                href={`/vs/${comp.slug}`}
                className="group block border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 transition hover:-translate-y-0.5"
                style={{ boxShadow: "3px 3px 0 var(--lp-ink)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{comp.flag}</span>
                  <span className="lp-display text-[1rem] text-[var(--lp-ink)]">{comp.name}</span>
                </div>
                <p className="lp-sans mt-2 text-[0.82rem] leading-[1.5] text-[var(--lp-ink)]/75">{comp.note}</p>
                <div className="lp-label mt-3 text-[var(--lp-red)] group-hover:underline">
                  See full comparison →
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/vs" className="lp-cta">
              View all comparisons
            </Link>
            <span className="lp-sans text-[0.9rem] text-[var(--lp-ink)]/70">
              Side-by-side comparisons for 8+ brands
            </span>
          </div>
        </div>
      </section>

      {/* Label disclaimer */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Label Details ★</p>
          <h2 className="lp-display text-[clamp(1.8rem,4.5vw,2.6rem)] text-[var(--lp-ink)]">
            Check the bag
            <br />
            <span className="lp-script text-[var(--lp-red)]">for the latest.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[58ch] text-[1.05rem] leading-[1.65] text-[var(--lp-ink)]/85">
            Ingredient lists and nutrition facts can vary slightly by production lot. Always review
            the ingredient panel on the bag for the most current ingredient and allergen details,
            or contact us if you have sensitivities.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/faq" className="lp-cta lp-cta-light">
              Read FAQ
            </Link>
            <Link href="/shop" className="lp-cta">
              Shop now
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Ingredients FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">before you buy.</span>
            </h2>
          </div>
          <div className="mt-6">
            {FAQS.map((item) => (
              <details key={item.question} className="lp-faq">
                <summary>{item.question}</summary>
                <div>{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <GuaranteeBlock />

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Shop the best
            <br />
            <span className="lp-script text-[var(--lp-red)]">value bundles.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop best value
            </Link>
            <Link href="/no-artificial-dyes-gummy-bears" className="lp-cta lp-cta-light">
              No Artificial Dyes guide
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
