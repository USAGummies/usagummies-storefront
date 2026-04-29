// /kids-safe-gummy-bears — kid-safe SEO funnel page in LP design language.
// Structure: PageHero → ScarcityBar → Highlights → Why-parents-choose grid →
// Ingredient call-out + "What's NOT in them" + BagSlider (client) → FAQ →
// ThreePromises → GuaranteeBlock → bottom CTA.
// Article + FAQPage + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
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
const PAGE_TITLE = "Dye-Free Gummy Bears Safe for Kids | USA Gummies";
const PAGE_DESCRIPTION =
  "Dye-free gummy bears parents can trust. USA Gummies are made in the USA with no artificial dyes, no Red 40, and all natural flavors. A cleaner candy choice for kids. Free shipping on every order.";
const PAGE_URL = `${SITE_URL}/kids-safe-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "Dye-Free Gummy Bears Safe for Kids";

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
    title: "No Red 40",
    body: "Zero synthetic color additives. No FD&C Red No. 40 or other certified dyes anywhere in our gummy bears.",
  },
  {
    title: "All Natural Flavors",
    body: "Real fruit flavors kids love — cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    title: "Made in the USA",
    body: "Sourced, made, and packed domestically with quality standards parents can verify.",
  },
];

const PARENT_REASONS = [
  {
    title: "Growing awareness of artificial dyes",
    body:
      "More parents are reading ingredient labels and looking for candy without synthetic color additives like Red 40, Yellow 5, and Blue 1.",
  },
  {
    title: "What FDA says about children and dyes",
    body:
      "FDA reports that most children show no adverse effects from color additives, but acknowledges some evidence of sensitivity in certain children and continues to evaluate new science.",
  },
  {
    title: "Making informed choices",
    body:
      "Whether you avoid dyes for dietary reasons, personal preference, or out of caution, choosing dye-free candy means one fewer thing to worry about at snack time.",
  },
];

const INGREDIENT_POINTS = [
  "Colors from fruit and vegetable extracts, spirulina, and curcumin — not synthetic dyes.",
  "All natural flavors derived from real fruit sources.",
  "No Red 40, no Yellow 5, no Blue 1, no artificial color additives of any kind.",
  "Classic gummy bear texture with gelatin, sugar, and corn syrup — simple ingredients you can read.",
];

const NOT_IN_THEM = [
  "No artificial dyes or synthetic color additives",
  "No Red 40, Yellow 5, Yellow 6, or Blue 1",
  "No artificial flavors",
  "No high-fructose corn syrup",
];

const FAQS = [
  {
    question: "Are USA Gummies safe for kids?",
    answer:
      "USA Gummies are made with no artificial dyes, no Red 40, and all natural flavors. They are a standard candy product made with sugar, corn syrup, and gelatin. As with any candy, they should be enjoyed in moderation as part of a balanced diet.",
  },
  {
    question: "Are USA Gummies allergen-free?",
    answer:
      "USA Gummies are free from the top 9 allergens (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, and sesame). However, they are produced in a facility that may process other products. Always check the bag for the most current allergen information.",
  },
  {
    question: "What age are these gummy bears appropriate for?",
    answer:
      "Gummy bears are generally appropriate for children old enough to thoroughly chew gummy candy. For very young children, parents should supervise to ensure proper chewing. Consult your pediatrician if you have specific concerns.",
  },
  {
    question: "Are USA Gummies sugar-free?",
    answer:
      "No. USA Gummies are made with sugar and corn syrup, like traditional gummy bears. They are not sugar-free or low-sugar. The difference is in what we leave out — artificial dyes and synthetic colors.",
  },
  {
    question: "Do USA Gummies contain gelatin?",
    answer:
      "Yes. USA Gummies contain gelatin, which gives them their classic gummy bear chew. They are not vegan or vegetarian.",
  },
  {
    question: "Where can I buy dye-free gummy bears for kids?",
    answer:
      "You can order USA Gummies directly from our website with free shipping on every order. We also sell on Amazon. Visit our shop page for current pricing and bundle deals.",
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
  // Conservative publish date — page predates audit but exact date unknown.
  datePublished: "2026-01-01",
  dateModified: "2026-04-29",
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

export default function KidsSafeGummyBearsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Dye-Free Gummy Bears for Kids", href: "/kids-safe-gummy-bears" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="Dye-Free Gummy Bears for Kids"
        headline="Candy parents"
        scriptAccent="can trust."
        sub="USA Gummies are made with no artificial dyes, no Red 40, and all natural flavors — a cleaner gummy bear that kids love and parents can feel good about. Made in the USA."
        ctas={[
          { href: "/shop", label: "Shop &amp; save" },
          { href: "/ingredients", label: "See ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Highlights */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Standard ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three reasons
              <br />
              <span className="lp-script text-[var(--lp-red)]">for snack-time peace of mind.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HIGHLIGHTS.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-8 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            {FREE_SHIPPING_PHRASE}.
          </p>
        </div>
      </section>

      {/* Why parents choose */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why Dye-Free ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Why more parents
              <br />
              <span className="lp-script text-[var(--lp-red)]">are skipping the dyes.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {PARENT_REASONS.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.25rem] leading-tight text-[var(--lp-ink)] sm:text-[1.4rem]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ingredients + NOT-in-them + BagSlider */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ What&rsquo;s in the Bag ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Simple ingredients
              <br />
              <span className="lp-script text-[var(--lp-red)]">you can read.</span>
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="grid gap-4">
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
              >
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ What&rsquo;s in them ★</p>
                <ul className="grid gap-3">
                  {INGREDIENT_POINTS.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                      <span className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/85">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-ink)" }}
              >
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ What&rsquo;s NOT in them ★</p>
                <ul className="grid gap-3">
                  {NOT_IN_THEM.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">×</span>
                      <span className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/85">{point}</span>
                    </li>
                  ))}
                </ul>
                <p className="lp-sans mt-4 text-[0.85rem] leading-[1.5] text-[var(--lp-ink)]/65">
                  Ingredient lists can change. Always check the bag for the most current label information.
                </p>
              </div>
            </div>

            <div
              id="kids-safe-buy"
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Shop Dye-Free ★</p>
              <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Bundle up to save more per bag.
              </h3>
              <p className="lp-sans mt-2 text-[0.95rem] leading-[1.6] text-[var(--lp-ink)]/82">
                {FREE_SHIPPING_PHRASE}.
              </p>
              <div className="mt-5">
                <BagSlider variant="full" defaultQty={5} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Kid-Safe Gummy FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">for parents.</span>
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
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Snack-time
            <br />
            <span className="lp-script text-[var(--lp-red)]">made simple.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop &amp; save
            </Link>
            <Link href="/ingredients" className="lp-cta lp-cta-light">
              See ingredients
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
