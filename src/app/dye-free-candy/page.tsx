import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
const PAGE_TITLE = "Dye-Free Candy Guide | USA Gummies";
const PAGE_DESCRIPTION =
  "Learn how to spot dye-free gummies and no artificial dyes on labels, plus why made in USA candy matters for patriotic gifts.";
const PAGE_URL = `${SITE_URL}/dye-free-candy`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;

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

const EDUCATION_CARDS = [
  {
    title: "What dye-free candy means",
    body:
      "Dye-free candy uses color sources like fruit and vegetable extracts instead of synthetic FD&C dyes. You will often see phrases like \"colors from fruit and vegetable extracts\" on the label.",
  },
  {
    title: "Why shoppers look for it",
    body:
      "Many people choose candy without artificial dyes for ingredient transparency, personal preference, or sensitivity concerns. The choice is about how the color is made, not a change to sugar content.",
  },
  {
    title: "How to confirm it on a label",
    body:
      "Scan the ingredient list for dye names such as Red 40, Yellow 5, Yellow 6, or Blue 1. If those are missing and color sources are listed instead, the candy is likely dye-free.",
  },
];

const COMPARISON_ROWS = [
  {
    label: "Color source",
    dyeFree: "Fruit and vegetable extracts, spirulina, turmeric, or other plant-based colors.",
    dyed: "Synthetic FD&C dyes like Red 40, Yellow 5, Yellow 6, or Blue 1.",
  },
  {
    label: "Label cues",
    dyeFree: "Phrases like \"colors from fruit and vegetable extracts\" or specific plant sources.",
    dyed: "Numbered dyes listed explicitly in the ingredients panel.",
  },
  {
    label: "Look in the bag",
    dyeFree: "Natural-looking hues that can be slightly softer or more fruit-toned.",
    dyed: "More uniform, bright, or neon-leaning colors.",
  },
  {
    label: "Who it fits",
    dyeFree: "Great for shoppers prioritizing ingredient transparency or dye-free gifting.",
    dyed: "Best if color vibrancy is the top priority and dyes are not a concern.",
  },
];

const HOW_TO_STEPS = [
  {
    title: "Read the ingredient list",
    body:
      "Look for numbered dyes like Red 40 or Yellow 5. If they appear, the candy is not dye-free.",
  },
  {
    title: "Confirm the color sources",
    body:
      "Dye-free candy will list fruit and vegetable extracts or plant-based sources like spirulina or turmeric.",
  },
  {
    title: "Match the candy to your needs",
    body:
      "If you have dietary needs beyond dyes, check the full ingredient panel and allergen information.",
  },
  {
    title: "Choose your format",
    body:
      "Pick single bags for everyday snacking or bundles for gifts and events.",
  },
];

const COLOR_SOURCES = [
  "Fruit and vegetable extracts",
  "Spirulina",
  "Turmeric (curcumin)",
  "Beet or carrot concentrates",
  "Paprika or annatto",
];

const FAQS = [
  {
    question: "What is dye-free candy?",
    answer:
      "Dye-free candy is colored without synthetic FD&C dyes and instead uses plant-based sources like fruit and vegetable extracts.",
  },
  {
    question: "Is candy without artificial dyes the same as sugar-free candy?",
    answer:
      "No. Dye-free refers to color sources, while sugar-free refers to sweeteners. The two are separate choices.",
  },
  {
    question: "How do I know if candy contains artificial dyes?",
    answer:
      "Check the ingredient list for dye names like Red 40, Yellow 5, Yellow 6, or Blue 1. If those are absent and plant sources are listed, it is likely dye-free.",
  },
  {
    question: "Do USA Gummies contain artificial dyes?",
    answer:
      "No. USA Gummies use colors from fruits, vegetables, spirulina, and curcumin instead of artificial dyes.",
  },
  {
    question: "Does dye-free candy taste different?",
    answer:
      "Flavor comes from the flavoring, not the dye. Dye-free candy can taste the same as candy with artificial dyes.",
  },
  {
    question: "Where can I see full ingredients for USA Gummies?",
    answer:
      "Visit the ingredients page for the full ingredient list and nutrition facts.",
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

const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to shop for dye-free candy",
  description: "A simple checklist for finding candy without artificial dyes.",
  step: HOW_TO_STEPS.map((step, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    name: step.title,
    text: step.body,
  })),
};

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Dye-free candy guide",
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

export default function DyeFreeCandyPage() {
  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Dye-Free Candy", href: "/dye-free-candy" },
          ]}
        />

        <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                Pillar guide
              </div>
              <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                Dye-free candy and candy without artificial dyes, explained.
              </h1>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                This guide covers what dye-free candy means, how to read ingredient labels, and how
                to compare dye-free candy to candy with artificial dyes. If you are shopping for
                candy without artificial dyes, start here.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop dye-free candy
                </Link>
                <Link href="/ingredients" className="btn btn-outline">
                  Ingredients
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                  <Image
                    src="/brand/usa-gummies-family.webp"
                    alt="Assorted USA Gummies dye-free gummy bear bags"
                    fill
                    sizes="(max-width: 768px) 90vw, 460px"
                    className="object-contain"
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Candy without artificial dyes
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    Colors from fruit and vegetable extracts with classic gummy bear flavor.
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="badge badge--navy">No artificial dyes</span>
                    <span className="badge badge--navy">All natural flavors</span>
                    <span className="badge badge--navy">Made in USA</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {EDUCATION_CARDS.map((card) => (
              <div key={card.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  {card.title}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">{card.body}</p>
              </div>
            ))}
          </div>

          <section className="mt-8" id="comparison">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Dye-free vs artificial dyes
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Quick comparison: dye-free candy vs candy with artificial dyes.
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
              Both options can taste great. The main difference is how color is created and how that
              choice shows up on the ingredient label.
            </p>
            <div className="mt-4 grid gap-3">
              {COMPARISON_ROWS.map((row) => (
                <div key={row.label} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    {row.label}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[rgba(15,27,45,0.1)] bg-[var(--surface-strong)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Dye-free candy
                      </div>
                      <p className="mt-2 text-sm text-[var(--text)]">{row.dyeFree}</p>
                    </div>
                    <div className="rounded-xl border border-[rgba(15,27,45,0.1)] bg-[var(--surface-strong)] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Artificial dyes
                      </div>
                      <p className="mt-2 text-sm text-[var(--text)]">{row.dyed}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="checklist">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Dye-free checklist
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              How to shop for candy without artificial dyes.
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {HOW_TO_STEPS.map((step, index) => (
                <div key={step.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Step {index + 1}
                  </div>
                  <div className="mt-2 text-base font-semibold text-[var(--text)]">{step.title}</div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{step.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="color-sources">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Common natural color sources
              </div>
              <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
                These are typical plant-based color sources you might see on dye-free candy labels.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {COLOR_SOURCES.map((source) => (
                  <span key={source} className="badge badge--navy">
                    {source}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-8" id="usa-gummies">
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                USA Gummies standard
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                A dye-free candy option made in the USA.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
                USA Gummies are colored with fruit and vegetable extracts and avoid artificial dyes.
                If you want a clean-label gummy bear for everyday snacking or gifting, explore the
                full ingredient list and shop the available bags and bundles.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop bundles
                </Link>
                <Link href="/ingredients" className="btn btn-outline">
                  See ingredients
                </Link>
                <Link href="/gummies-101" className="btn btn-outline">
                  Gummies 101
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-8" id="faqs">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              FAQs
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Dye-free candy questions, answered.
            </h2>
            <div className="mt-4 space-y-2">
              {FAQS.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                    <span>{item.question}</span>
                    <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-2 text-sm text-[var(--muted)]">{item.answer}</div>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-8" id="related-links">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Keep exploring
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/dye-free-movement" className="btn btn-outline">
                  Dye-free timeline
                </Link>
                <Link href="/vs" className="btn btn-outline">
                  Brand comparisons
                </Link>
                <Link href="/bulk-gummy-bears" className="btn btn-outline">
                  Bulk gummy bears
                </Link>
                <Link href="/gummy-gift-bundles" className="btn btn-outline">
                  Gift bundles
                </Link>
                <Link href="/made-in-usa" className="btn btn-outline">
                  Made in USA
                </Link>
                <Link href="/faq" className="btn btn-outline">
                  FAQ
                </Link>
                <Link href="/contact" className="btn btn-outline">
                  Contact
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <LatestFromBlog />
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </main>
  );
}
