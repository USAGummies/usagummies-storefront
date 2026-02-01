import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

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
const PAGE_TITLE = "Ingredients & Nutrition Facts | USA Gummies";
const PAGE_DESCRIPTION =
  "Full ingredient list and nutrition facts for USA Gummies. See serving size, calories, and flavor notes for our All American gummy bears.";
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
  },
  {
    name: "Watermelon",
    notes: "Smooth and refreshing, a light summer watermelon note.",
  },
  {
    name: "Orange",
    notes: "Citrus pop with a sweet, familiar orange flavor.",
  },
  {
    name: "Green apple",
    notes: "Crisp green apple with a balanced sweet-tart bite.",
  },
  {
    name: "Lemon",
    notes: "Zesty lemon lift that keeps the chew bright and clean.",
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

export default function IngredientsPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(255,77,79,0.14), transparent 48%), radial-gradient(circle at 85% 5%, rgba(255,199,44,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Ingredients", href: "/ingredients" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  Ingredients and nutrition facts
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  Ingredients, nutrition facts, and flavor notes.
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Find the full ingredient list and nutrition facts for our 7.5 oz bag. USA Gummies
                  are All American gummy bears with all natural flavors, no artificial dyes, and a
                  clean, chewy finish.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop now
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
                  <span className="candy-pill">Made in USA</span>
                  <span className="candy-pill">No artificial dyes</span>
                  <span className="candy-pill">All natural flavors</span>
                  <span className="candy-pill">5 fruit flavors</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="USA Gummies bags with gummy bears"
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-contain"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      7.5 oz bag with 5 fruit flavors
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Cherry, watermelon, orange, green apple, and lemon.
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <span className="badge badge--navy">No artificial dyes</span>
                      <span className="badge badge--navy">All natural flavors</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Ingredient list
                </div>
                <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                  {INGREDIENTS_LIST.map((ingredient) => (
                    <li key={ingredient} className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>{ingredient}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-xs text-[var(--muted)]">
                  Contains gelatin. Ingredients listed as shown on our 7.5 oz bag.
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Nutrition facts
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {SERVINGS_PER_CONTAINER} servings per container
                  </div>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">Serving size {SERVING_SIZE}</div>
                <div className="mt-3 border-y border-[var(--border)] py-2">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                    Amount per serving
                  </div>
                  <div className="mt-1 flex items-end justify-between">
                    <div className="text-sm font-semibold text-[var(--text)]">Calories</div>
                    <div className="text-2xl font-black text-[var(--text)]">{CALORIES}</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  % Daily Value*
                </div>
                <div className="mt-2 divide-y divide-[var(--border)]">
                  {NUTRITION_ROWS.map((row) => {
                    const indentClass =
                      row.indent === 2 ? "pl-7" : row.indent === 1 ? "pl-4" : "";
                    const labelClass = row.strong
                      ? "font-semibold text-[var(--text)]"
                      : "text-[var(--muted)]";
                    return (
                      <div key={row.label} className="flex items-start justify-between gap-3 py-2 text-xs sm:text-sm">
                        <div className={`flex-1 ${indentClass}`}>
                          <span className={labelClass}>{row.label}</span>
                          {row.amount ? <span className="ml-2 text-[var(--text)]">{row.amount}</span> : null}
                        </div>
                        <div className="text-xs text-[var(--muted)]">{row.dv ?? ""}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-[10px] text-[var(--muted)]">{NUTRITION_FOOTNOTE}</div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {QUALITY_POINTS.map((point) => (
                <div key={point.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {point.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{point.body}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {FLAVORS.map((flavor) => (
                <div
                  key={flavor.name}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4"
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{flavor.name}</div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{flavor.notes}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Ingredients FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers before you buy.
              </h2>
              <div className="mt-4 space-y-2">
                {FAQS.map((item) => (
                  <details
                    key={item.question}
                    className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                      <span>{item.question}</span>
                      <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <div className="mt-2 text-sm text-[var(--muted)]">{item.answer}</div>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Label details
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Check the bag for the most current info.
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Ingredient lists and nutrition facts can vary slightly by production lot. Always review
              the ingredient panel on the bag for the most current ingredient and allergen details,
              or contact us if you have sensitivities.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/faq" className="btn btn-outline">
                Read FAQ
              </Link>
              <Link href="/shop" className="btn btn-candy">
                Shop now
              </Link>
            </div>
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Ready to order
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  Shop the best value bundles.
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
                </p>
              </div>
              <Link href="/shop" className="btn btn-candy">
                Shop best value
              </Link>
            </div>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
