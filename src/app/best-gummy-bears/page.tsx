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
const PAGE_TITLE = "Best Gummy Bears of 2026 | USA Gummies";
const PAGE_DESCRIPTION =
  "Discover the best gummy bears of 2026. USA Gummies are made in the USA with no artificial dyes, all natural flavors, and a classic soft chew. Free shipping on 5+ bags.";
const PAGE_URL = `${SITE_URL}/best-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "Best Gummy Bears of 2026";

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
    title: "Made in the USA",
    body: "Sourced, made, and packed in the United States. No outsourced production or mystery supply chains.",
  },
  {
    title: "All Natural Flavors",
    body: "Five classic fruit flavors — cherry, watermelon, orange, green apple, and lemon — from natural sources.",
  },
  {
    title: "No Artificial Dyes",
    body: "Colors come from fruit and vegetable extracts, spirulina, and curcumin. No synthetic dyes.",
  },
];

const WHAT_MAKES_BEST = [
  {
    title: "Texture and chew quality",
    body: "The best gummy bears have a soft, satisfying chew that isn't too hard or too sticky. USA Gummies use a classic gelatin-based recipe for a consistent bite every time.",
  },
  {
    title: "Clean ingredients",
    body: "Premium gummy bears skip the artificial dyes and synthetic flavors. USA Gummies are made with no artificial dyes and all natural flavors for a cleaner ingredient list.",
  },
  {
    title: "Flavor variety",
    body: "A great gummy bear bag offers distinct, recognizable fruit flavors. Each USA Gummies bag includes five flavors you can actually tell apart — cherry, watermelon, orange, green apple, and lemon.",
  },
];

const COMPARISON_POINTS = [
  {
    title: "Ingredients you can read",
    body: "Most mass-market gummy bears use Red 40, Yellow 5, and Blue 1. USA Gummies use fruit and vegetable extracts for color and all natural flavors.",
  },
  {
    title: "Made domestically",
    body: "Many popular gummy bears are manufactured overseas and imported. USA Gummies are sourced, made, and packed entirely in the United States.",
  },
  {
    title: "No artificial dyes or synthetic colors",
    body: "Generic gummy bears rely on certified synthetic color additives. USA Gummies get their color from spirulina, curcumin, and fruit and vegetable extracts.",
  },
];

const FAQS = [
  {
    question: "What makes USA Gummies the best gummy bears?",
    answer:
      "USA Gummies combine a classic soft chew with clean ingredients — no artificial dyes, all natural flavors, and domestic production. They are sourced, made, and packed in the USA.",
  },
  {
    question: "What ingredients are in USA Gummies?",
    answer:
      "USA Gummies are made with all natural flavors and colored with fruit and vegetable extracts, spirulina, and curcumin. They contain gelatin and are free from artificial dyes and synthetic colors.",
  },
  {
    question: "What flavors do USA Gummies come in?",
    answer:
      "Each bag includes five fruit flavors: cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "Do you offer free shipping?",
    answer:
      "Yes. Orders of 5 or more bags ship free within the United States.",
  },
  {
    question: "Where are USA Gummies made?",
    answer:
      "USA Gummies are sourced, made, and packed in the United States.",
  },
  {
    question: "Are USA Gummies gluten free?",
    answer:
      "USA Gummies are made in a facility that processes wheat, so we cannot guarantee they are gluten free. Always check the bag for the most current allergen information.",
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

export default function BestGummyBearsPage() {
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
              { name: "Best Gummy Bears of 2026", href: "/best-gummy-bears" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  Best gummy bears of 2026
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  Best Gummy Bears of 2026
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  What makes the best gummy bears? A clean ingredient list, a classic soft chew, and
                  flavors you can actually taste. USA Gummies are made in the USA with no artificial
                  dyes, all natural flavors, and five distinct fruit flavors in every bag.
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
                  <span className="candy-pill">Made in USA</span>
                  <span className="candy-pill">No artificial dyes</span>
                  <span className="candy-pill">All natural flavors</span>
                  <span className="candy-pill">Classic soft chew</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="USA Gummies best gummy bears assorted bags"
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
                      <span className="badge badge--navy">Best seller</span>
                      <span className="badge badge--navy">No artificial dyes</span>
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
                What makes the best gummy bears
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Three things that separate great gummy bears from the rest.
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {WHAT_MAKES_BEST.map((item) => (
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
                    How we compare
                  </div>
                  <div className="mt-3 space-y-3">
                    {COMPARISON_POINTS.map((item) => (
                      <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                        <div className="text-sm font-semibold text-[var(--text)]">{item.title}</div>
                        <div className="mt-2 text-sm text-[var(--muted)]">{item.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4" id="best-gummy-bears-buy">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Shop the best gummy bears
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
                Best gummy bears FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers about USA Gummies.
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
