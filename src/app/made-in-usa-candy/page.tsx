import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
const PAGE_TITLE = "Made in USA Candy Guide";
const PAGE_DESCRIPTION =
  "Everything you need to know about candy made in the USA. How to verify domestic sourcing, why it matters, and where to find dye-free gummies manufactured in America.";
const PAGE_URL = `${SITE_URL}/made-in-usa-candy`;
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

const OUTLINE_ITEMS = [
  "H1: Made in USA Candy: The Complete Guide to American-Made Sweets",
  "H2: What \"Made in USA\" Means for Candy Buyers",
  "H3: The sourcing, manufacturing, and packing standard",
  "H2: Why American-Made Candy Tastes Better (and Feels Better)",
  "H3: Consistent quality and freshness",
  "H3: Cleaner ingredient expectations",
  "H2: How USA Gummies Are Made in America",
  "H3: Sourcing and ingredient choices",
  "H3: Cooking, molding, and finishing",
  "H3: Packing and fulfillment in the USA",
  "H2: Choosing the Right Bundle for Your Order",
  "H3: Everyday snacking",
  "H3: Parties and events",
  "H3: Corporate gifting and bulk",
  "H2: FAQs About Made in USA Candy",
  "H3: Where are USA Gummies made?",
  "H3: Do you use artificial dyes?",
  "H3: How fast do orders ship?",
  "H3: Are USA Gummies good for gifting?",
  "H3: Can I order in bulk?",
  "H3: What flavors are available?",
];

const STANDARD_BULLETS = [
  "Ingredients sourced to a higher standard.",
  "Cooking and molding done in American facilities.",
  "Packing and fulfillment handled in the USA for faster shipping.",
];

const WHY_POINTS = [
  {
    title: "Consistent quality and freshness",
    body:
      "Domestic production reduces long transit times and storage delays. The result is a fresher bite, better chew, and more reliable texture.",
  },
  {
    title: "Cleaner ingredient expectations",
    body:
      "Many customers choosing Made in USA candy prefer candies made with all natural flavors and colors from fruit and vegetable extracts instead of synthetic dyes. If that matters to you, check the ingredient list and brand standards first.",
    link: { href: "/ingredients", label: "See ingredients" },
  },
];

const PROCESS_STEPS = [
  {
    title: "Sourcing and ingredient choices",
    body:
      "We prioritize dependable supply chains and ingredient choices that align with a clean-label approach. Our gummies use all natural flavors and avoid artificial dyes.",
  },
  {
    title: "Cooking, molding, and finishing",
    body:
      "The gummy process is all about balance: consistent cooking temperatures, precise molding, and careful finishing so every bear delivers the same chew and flavor.",
  },
  {
    title: "Packing and fulfillment in the USA",
    body:
      "Packaging happens in the United States, so orders move fast and arrive ready for snacking, sharing, or gifting.",
    link: { href: "/shop", label: "Shop now" },
  },
];

const BUNDLE_USE_CASES = [
  {
    title: "Everyday snacking",
    body: "For weekly treats or family candy bowls, start with a smaller bundle.",
    link: { href: "/bundle-guides", label: "Explore bundle guides" },
  },
  {
    title: "Parties and events",
    body:
      "If you are stocking a candy bar or party table, choose a larger bundle to keep guests happy.",
    link: { href: "/gummy-gift-bundles", label: "Shop gummy gift bundles" },
  },
  {
    title: "Corporate gifting and bulk",
    body: "Need to order for teams or events? Bulk options make it easy to scale.",
    link: { href: "/bulk-gummy-bears", label: "See bulk gummy bears" },
  },
];

const INTERNAL_LINKS = [
  { label: "About USA Gummies", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact us", href: "/contact" },
];

const CTA_CARDS = [
  {
    title: "Ready to stock up on Made in USA candy?",
    link: { href: "/shop", label: "Shop & save" },
  },
  {
    title: "Building a party table or office pantry?",
    link: { href: "/bundle-guides", label: "Browse bundles" },
  },
  {
    title: "Want to see what goes into every bag?",
    link: { href: "/ingredients", label: "See ingredients" },
  },
];

const FAQS = [
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Do you use artificial dyes?",
    answer: "No. Colors come from fruit and vegetable extracts, not synthetic dyes.",
  },
  {
    question: "How fast do orders ship?",
    answer: "Most orders ship within 24 hours, and tracking is provided once labels are created.",
  },
  {
    question: "Are USA Gummies good for gifting?",
    answer:
      "Yes. Our bundles are designed to make gifting simple for holidays, events, and corporate needs.",
    link: { href: "/gummy-gift-bundles", label: "Shop gummy gift bundles" },
  },
  {
    question: "Can I order in bulk?",
    answer: "Absolutely. If you need larger quantities for events or teams, start here:",
    link: { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  },
  {
    question: "What flavors are available?",
    answer: "Flavor availability varies by bundle. For the latest, browse the shop.",
    link: { href: "/shop", label: "Shop now" },
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
  headline: "Made in USA candy guide",
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

export default function MadeInUsaCandyPage() {
  const latestFromBlog = <LatestFromBlog />;
  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Made in USA Candy", href: "/made-in-usa-candy" },
          ]}
        />

        <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                Pillar guide
              </div>
              <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                Made in USA Candy: The Complete Guide to American-Made Sweets
              </h1>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                When you search for Made in USA candy, you are looking for more than a flavor. You
                are looking for trust, transparency, and the pride of supporting American
                manufacturing. This pillar page breaks down what &quot;Made in USA&quot; really means for
                candy, how American-made gummies are produced, and how to choose the right bundle
                for your needs.
              </p>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Quick actions
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop &amp; save
                  </Link>
                  <Link href="/bundle-guides" className="btn btn-outline">
                    Explore bundles
                  </Link>
                  <Link href="/ingredients" className="btn btn-outline">
                    See ingredients
                  </Link>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                  <Image
                    src="/brand/usa-gummies-family.webp"
                    alt="Made in USA candy from USA Gummies"
                    fill
                    sizes="(max-width: 768px) 90vw, 460px"
                    className="object-contain"
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Made in USA candy
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    American-made gummy bears with all natural flavors and no artificial dyes.
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="badge badge--navy">Made in USA</span>
                    <span className="badge badge--navy">All natural flavors</span>
                    <span className="badge badge--navy">No artificial dyes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="mt-8" id="outline">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                On this page
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                On This Page (H1-H3 Outline)
              </h2>
              <ol className="mt-3 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-2">
                {OUTLINE_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mt-8" id="meaning">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Definition
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              What &quot;Made in USA&quot; Means for Candy Buyers
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
              Buying Made in USA candy typically means the product is sourced, manufactured, and
              packed in the United States. For a candy brand, that translates into tighter
              oversight, faster turnaround times, and more consistent quality from batch to batch.
            </p>
            <h3 className="mt-4 text-lg font-semibold text-[var(--text)]">
              The sourcing, manufacturing, and packing standard
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
              {STANDARD_BULLETS.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-[var(--muted)] max-w-prose">
              If you are looking for a candy brand that supports American jobs and avoids opaque
              supply chains, this is the standard to seek.
            </p>
          </section>

          <section className="mt-8" id="why">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Why it matters
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Why American-Made Candy Tastes Better (and Feels Better)
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
              There is a reason customers choose American-made gummies over mass-imported candy:
              consistent quality and a cleaner ingredient expectation.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {WHY_POINTS.map((point) => (
                <div key={point.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <h3 className="text-base font-semibold text-[var(--text)]">{point.title}</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {point.body}{" "}
                    {point.link ? (
                      <Link href={point.link.href} className="text-[var(--text)] underline">
                        {point.link.label}
                      </Link>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="process">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              How it is made
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              How USA Gummies Are Made in America
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
              USA Gummies are built on American manufacturing, from sourcing through packing.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {PROCESS_STEPS.map((step) => (
                <div key={step.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <h3 className="text-base font-semibold text-[var(--text)]">{step.title}</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {step.body}{" "}
                    {step.link ? (
                      <Link href={step.link.href} className="text-[var(--text)] underline">
                        {step.link.label}
                      </Link>
                    ) : null}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="bundles">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Bundle sizing
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Choosing the Right Bundle for Your Order
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
              Made in USA candy is even better when you pick the right bundle size for your moment.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {BUNDLE_USE_CASES.map((useCase) => (
                <div key={useCase.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <h3 className="text-base font-semibold text-[var(--text)]">{useCase.title}</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">{useCase.body}</p>
                  <div className="mt-3">
                    <Link href={useCase.link.href} className="btn btn-outline">
                      {useCase.link.label}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="internal-links">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Internal links
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Internal Links You Might Like
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {INTERNAL_LINKS.map((item) => (
                  <Link key={item.href} href={item.href} className="btn btn-outline">
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-8" id="ctas">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Conversion CTAs
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">Conversion CTAs</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {CTA_CARDS.map((card) => (
                <div key={card.title} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">{card.title}</p>
                  <div className="mt-3">
                    <Link href={card.link.href} className="btn btn-candy">
                      {card.link.label}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8" id="faqs">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              FAQs
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              FAQs About Made in USA Candy
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
                  <div className="mt-2 text-sm text-[var(--muted)]">
                    {item.answer}{" "}
                    {item.link ? (
                      <Link href={item.link.href} className="text-[var(--text)] underline">
                        {item.link.label}
                      </Link>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-8" id="bottom-line">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                The bottom line
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                The Bottom Line on Made in USA Candy
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)] max-w-prose">
                Choosing Made in USA candy is a simple way to back American jobs and get a cleaner,
                more consistent product. If you want gummy bears made at home with ingredients you
                can feel good about, USA Gummies is built for you.
              </p>
              <div className="mt-4">
                <Link href="/shop" className="btn btn-candy">
                  Shop &amp; save
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          {latestFromBlog}
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </main>
  );
}
