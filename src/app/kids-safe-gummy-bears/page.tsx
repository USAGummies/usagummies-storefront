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
const PAGE_TITLE = "Dye-Free Gummy Bears Safe for Kids | USA Gummies";
const PAGE_DESCRIPTION =
  "Dye-free gummy bears parents can trust. USA Gummies are made in the USA with no artificial dyes, no Red 40, and all natural flavors. A cleaner candy choice for kids. Free shipping on 5+ bags.";
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
      "You can order USA Gummies directly from our website with free shipping on orders of 5 or more bags. We also sell on Amazon. Visit our shop page for current pricing and bundle deals.",
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

export default function KidsSafeGummyBearsPage() {
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
              { name: "Dye-Free Gummy Bears for Kids", href: "/kids-safe-gummy-bears" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  Dye-free gummy bears for kids
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  Dye-Free Gummy Bears Safe for Kids
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Parents deserve candy they can feel good about. USA Gummies are made with no
                  artificial dyes, no Red 40, and all natural flavors — a cleaner gummy bear
                  that kids love and parents can trust. Made in the USA.
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
                  <span className="candy-pill">No Red 40</span>
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
                      alt="USA Gummies dye-free gummy bear bags for kids"
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
                      <span className="badge badge--navy">Dye-free</span>
                      <span className="badge badge--navy">Kid-safe ingredients</span>
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
                Why parents choose dye-free
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Why more parents are choosing dye-free gummy bears for their kids.
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {PARENT_REASONS.map((item) => (
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
                    What&#39;s in our gummy bears
                  </div>
                  <h2 className="mt-2 text-lg font-black text-[var(--text)]">
                    Simple ingredients you can read and understand.
                  </h2>
                  <div className="mt-3 space-y-3">
                    {INGREDIENT_POINTS.map((point) => (
                      <div key={point} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                        <div className="flex items-start gap-2 text-sm text-[var(--muted)]">
                          <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                          <span>{point}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    What&#39;s NOT in them
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>No artificial dyes or synthetic color additives</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>No Red 40, Yellow 5, Yellow 6, or Blue 1</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>No artificial flavors</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                      <span>No high-fructose corn syrup</span>
                    </li>
                  </ul>
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    Ingredient lists can change. Always check the bag for the most current label
                    information.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4" id="kids-safe-buy">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Shop dye-free gummy bears
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
                Kids safe gummy bears FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers about dye-free gummy bears for kids.
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
