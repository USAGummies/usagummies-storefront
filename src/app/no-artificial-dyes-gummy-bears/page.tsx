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
const PAGE_TITLE = "Red 40 Free Gummies | No Artificial Dyes Gummy Bears";
const PAGE_DESCRIPTION =
  "Looking for red 40 free gummies? USA Gummies are no artificial dyes gummy bears made in the USA with colors from fruit and vegetable extracts.";
const PAGE_URL = `${SITE_URL}/no-artificial-dyes-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "No Artificial Dyes Gummy Bears";

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
    title: "Red 40 free gummies",
    body: "No FD&C Red No. 40 or other certified synthetic colors.",
  },
  {
    title: "No artificial dyes",
    body: "Colors come from fruit and vegetable extracts, spirulina, and curcumin.",
  },
  {
    title: "Made in the USA",
    body: "All natural flavors with a clean, classic gummy bear chew.",
  },
];

const SCIENCE_CONTEXT = [
  {
    title: "Certified colors are synthetic",
    body:
      "FDA notes that certified colors are synthetic and require batch certification before use.",
  },
  {
    title: "Exempt colors come from natural sources",
    body:
      "FDA describes exempt colors as pigments from sources like vegetables, minerals, or animals, and they still require FDA approval.",
  },
  {
    title: "What FDA says about behavior",
    body:
      "FDA reports that most children show no adverse effects from color additives, but some evidence suggests sensitivity in certain children and the agency continues to evaluate new science.",
  },
];

const REGULATORY_REFERENCES = [
  {
    title: "U.S. label rules for certified colors",
    body:
      "FDA requires certified color additives to be listed by name on food labels (for example, FD&C Red No. 40 or Red 40).",
  },
  {
    title: "Red 40 in the CFR",
    body:
      "FD&C Red No. 40 is listed in 21 CFR 74.340, may be used for coloring foods consistent with good manufacturing practice, and batches must be certified under 21 CFR Part 80.",
  },
  {
    title: "UK warning labels for certain colors",
    body:
      "UK guidance requires warning labels for foods containing certain colors, including Allura Red (E129), indicating they may have an adverse effect on activity and attention in children.",
  },
];

const LABEL_TIPS = [
  "Look for certified colors listed by name, such as FD&C Red No. 40 or the shortened Red 40.",
  "Exempt colors can appear as 'color added' or 'artificial colors' instead of each individual name.",
  "If you want dye-free gummies, confirm the ingredient list calls out fruit or vegetable-based colors.",
];

const FAQS = [
  {
    question: "Are USA Gummies red 40 free?",
    answer:
      "Yes. USA Gummies do not use FD&C Red No. 40. Color comes from fruit and vegetable extracts, spirulina, and curcumin.",
  },
  {
    question: "Do you use any artificial dyes or synthetic colors?",
    answer: "No. We do not use artificial dyes or synthetic colors.",
  },
  {
    question: "How is Red 40 listed on U.S. labels?",
    answer:
      "Certified colors are listed by name in the ingredient list, such as FD&C Red No. 40 or Red 40.",
  },
  {
    question: "Are these gummies vegan?",
    answer: "No. USA Gummies contain gelatin.",
  },
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Where can I see full ingredient and nutrition details?",
    answer: "Visit the ingredients page for the most current label information.",
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

export default function NoArtificialDyesPage() {
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
              { name: "No Artificial Dyes Gummy Bears", href: "/no-artificial-dyes-gummy-bears" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  No artificial dyes gummy bears
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  No Artificial Dyes Gummy Bears
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Looking for red 40 free gummies? USA Gummies are colored with fruit and vegetable
                  extracts for a classic gummy bear look, without artificial dyes or synthetic
                  colors. Made in the USA with all natural flavors.
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
                  <span className="candy-pill">Red 40 free</span>
                  <span className="candy-pill">No artificial dyes</span>
                  <span className="candy-pill">Made in USA</span>
                  <span className="candy-pill">All natural flavors</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="Assorted USA Gummies gummy bear bags"
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
                      <span className="badge badge--navy">Red 40 free</span>
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
                Scientific context
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                The science and regulatory context behind dye-free gummies.
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {SCIENCE_CONTEXT.map((item) => (
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
                    Regulatory references
                  </div>
                  <div className="mt-3 space-y-3">
                    {REGULATORY_REFERENCES.map((item) => (
                      <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                        <div className="text-sm font-semibold text-[var(--text)]">{item.title}</div>
                        <div className="mt-2 text-sm text-[var(--muted)]">{item.body}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    How to spot Red 40 on a label
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    {LABEL_TIPS.map((tip) => (
                      <li key={tip} className="flex items-start gap-2">
                        <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    Ingredient lists can change. Always check the bag for the most current label
                    information.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4" id="red-40-free-buy">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Shop red 40 free gummies
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
                No artificial dyes FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers about red 40 free gummies.
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
