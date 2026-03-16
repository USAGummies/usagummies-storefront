import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
const PAGE_TITLE = "All Natural Gummy Bears | No Artificial Ingredients | USA Gummies";
const PAGE_DESCRIPTION =
  "All natural gummy bears made in the USA with fruit and vegetable colors, natural flavors, and no artificial dyes. Clean ingredients you can trust. Free shipping on 5+ bags.";
const PAGE_URL = `${SITE_URL}/natural-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "All Natural Gummy Bears";

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

const HIGHLIGHTS = [
  {
    title: "Natural Colors Only",
    body: "Every color comes from fruit and vegetable extracts like spirulina, curcumin, and beta-carotene. Zero synthetic dyes.",
  },
  {
    title: "All Natural Flavors",
    body: "Real fruit-derived flavoring in every bear. No artificial flavoring agents or synthetic taste enhancers.",
  },
  {
    title: "Clean Label",
    body: "A simple ingredient list you can actually read. No high-fructose corn syrup, no artificial preservatives.",
  },
];

const WHAT_NATURAL_MEANS = [
  {
    title: "Natural vs. artificial colors",
    body:
      "Natural colors are derived from plant, mineral, or animal sources such as fruit and vegetable extracts, spirulina, and curcumin. Artificial colors are chemically synthesized and must be batch-certified by the FDA before use.",
  },
  {
    title: "Natural flavoring explained",
    body:
      "Natural flavors are derived from real food sources including fruits, vegetables, herbs, and spices. They capture the taste profile of the original ingredient without synthetic chemical compounds.",
  },
  {
    title: "Clean manufacturing",
    body:
      "Our gummies are produced in a USA-based facility with strict quality controls. Every batch is made with the same commitment to natural ingredients from sourcing through packaging.",
  },
];

const OUR_INGREDIENTS = {
  whatsIn: [
    "Fruit and vegetable extracts for color (spirulina, curcumin, beta-carotene, black carrot)",
    "Natural fruit flavors (cherry, watermelon, orange, green apple, lemon)",
    "Cane sugar and glucose syrup",
    "Gelatin for the classic gummy chew",
    "Citric acid for a touch of tartness",
  ],
  whatsOut: [
    "No artificial dyes or synthetic colors (no Red 40, Yellow 5, Blue 1)",
    "No artificial flavors",
    "No high-fructose corn syrup",
    "No artificial preservatives",
    "No wax coatings",
  ],
};

const FAQS = [
  {
    question: "Are USA Gummies all natural?",
    answer:
      "USA Gummies are made with all natural flavors and colors derived from fruit and vegetable extracts. We do not use artificial dyes, artificial flavors, or high-fructose corn syrup.",
  },
  {
    question: "What natural colors do you use?",
    answer:
      "Our colors come from fruit and vegetable extracts including spirulina, curcumin, beta-carotene, and black carrot extract. No synthetic dyes like Red 40 or Yellow 5 are used.",
  },
  {
    question: "Are these gummies organic?",
    answer:
      "USA Gummies are not certified organic. However, we use natural colors and natural flavors with a clean, simple ingredient list.",
  },
  {
    question: "Do they contain common allergens?",
    answer:
      "USA Gummies contain gelatin. They are free from the top allergens including peanuts, tree nuts, milk, eggs, wheat, soy, fish, and shellfish. Always check the bag for the most current label information.",
  },
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Are these gummies vegan?",
    answer: "No. USA Gummies contain gelatin, which is an animal-derived ingredient.",
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
    "@id": PAGE_URL,
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

export default function NaturalGummyBearsPage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen home-candy">
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
              { name: "All Natural Gummy Bears", href: "/natural-gummy-bears" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  All natural gummy bears
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  All Natural Gummy Bears
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Clean ingredients, real fruit flavors, and absolutely no synthetic anything.
                  USA Gummies are colored with fruit and vegetable extracts and flavored with
                  natural flavors for a classic gummy bear you can feel good about. Made in the USA.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop & save
                  </Link>
                  <Link href="/ingredients" className="btn btn-outline">
                    See ingredients
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
                  <span className="candy-pill">All natural</span>
                  <span className="candy-pill">No artificial dyes</span>
                  <span className="candy-pill">Made in USA</span>
                  <span className="candy-pill">Natural flavors</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="Assorted USA Gummies all natural gummy bear bags"
                      fill
                      priority
                      fetchPriority="high"
                      sizes="(max-width: 640px) 90vw, (max-width: 1024px) 55vw, 460px"
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
                      <span className="badge badge--navy">All natural</span>
                      <span className="badge badge--navy">Clean label</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {item.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{item.body}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                What natural means
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                What it really means to be an all natural gummy bear.
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {WHAT_NATURAL_MEANS.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                    <div className="text-sm font-semibold text-[var(--text)]">{item.title}</div>
                    <div className="mt-2 text-sm text-[var(--muted)]">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Our ingredients
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                      <div className="text-sm font-semibold text-[var(--text)]">What goes in</div>
                      <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
                        {OUR_INGREDIENTS.whatsIn.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                      <div className="text-sm font-semibold text-[var(--text)]">What stays out</div>
                      <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
                        {OUR_INGREDIENTS.whatsOut.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    How to read labels
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>Check for &quot;natural flavors&quot; instead of &quot;artificial flavors&quot; in the ingredient list.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>Look for colors listed as fruit or vegetable extracts rather than FD&amp;C dye names like Red 40.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>A shorter ingredient list usually means fewer additives and a cleaner product.</span>
                    </li>
                  </ul>
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    Ingredient lists can change. Always check the bag for the most current label
                    information.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4" id="natural-gummy-bears-buy">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Shop all natural gummy bears
                </div>
                <div className="mt-2 text-sm text-[var(--muted)]">
                  Bundle up to save more per bag. {FREE_SHIPPING_PHRASE}
                </div>
                <div className="mt-4">
                  <BagSlider variant="full" defaultQty={5} />
                </div>
              </div>
            </div>

            <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Natural gummy bears FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers about all natural gummy bears.
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
                Shop & save
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
