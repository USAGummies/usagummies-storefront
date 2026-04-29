// /made-in-usa-candy — pillar guide page in LP design language. Structure:
// PageHero → ScarcityBar → "What it means" definition + standard bullets →
// Why-it-matters grid → Process steps grid → Bundle picks → Internal links →
// Conversion CTA cards → FAQ → ThreePromises → SustainabilityBlock →
// GuaranteeBlock → bottom CTA.
// Article + FAQPage + Breadcrumb JSON-LD preserved for SEO. Page outline kept
// as a navigable summary block.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
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
const PAGE_TITLE = "Made in USA Candy Guide | USA Gummies";
const PAGE_DESCRIPTION =
  "Pillar guide to made in USA candy: what it means, how USA Gummies are made, bundle sizing, FAQs, and where to shop.";
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
    title: "Sourcing & ingredient choices",
    body:
      "We prioritize dependable supply chains and ingredient choices that align with a clean-label approach. Our gummies use all natural flavors and avoid artificial dyes.",
  },
  {
    title: "Cooking, molding, finishing",
    body:
      "The gummy process is all about balance — consistent cooking temperatures, precise molding, and careful finishing so every bear delivers the same chew and flavor.",
  },
  {
    title: "Packing & fulfillment in the USA",
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
    link: { href: "/gummy-gift-bundles", label: "Shop gift bundles" },
  },
  {
    title: "Corporate gifting & bulk",
    body: "Need to order for teams or events? Bulk options make it easy to scale.",
    link: { href: "/bulk-gummy-bears", label: "See bulk bears" },
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
    link: { href: "/shop", label: "Shop &amp; save" },
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
    link: { href: "/gummy-gift-bundles", label: "Shop gift bundles" },
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

export default function MadeInUsaCandyPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Made in USA Candy", href: "/made-in-usa-candy" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="Made in USA Candy / Pillar Guide"
        headline="Made-in-USA candy,"
        scriptAccent="the complete guide."
        sub="More than a flavor — Made in USA candy means trust, transparency, and the pride of supporting American manufacturing. Here&rsquo;s what it really means, how American-made gummies are produced, and how to pick the right bundle."
        ctas={[
          { href: "/shop", label: "Shop &amp; save" },
          { href: "/bundle-guides", label: "Explore bundles", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Definition + standard */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]" id="meaning">
        <div className="mx-auto max-w-[1000px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Definition ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              What &ldquo;Made in USA&rdquo; means
              <br />
              <span className="lp-script text-[var(--lp-red)]">for candy buyers.</span>
            </h2>
          </div>
          <p className="lp-sans mx-auto max-w-[60ch] text-center text-[1.05rem] leading-[1.7] text-[var(--lp-ink)]/85">
            Buying Made in USA candy typically means the product is sourced, manufactured, and packed
            in the United States. For a candy brand, that translates into tighter oversight, faster
            turnaround times, and more consistent quality from batch to batch.
          </p>
          <div
            className="mx-auto mt-8 max-w-[760px] border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <p className="lp-label mb-3 text-[var(--lp-red)]">★ The Standard ★</p>
            <ul className="grid gap-3">
              {STANDARD_BULLETS.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3">
                  <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                  <span className="lp-sans text-[1rem] leading-[1.55] text-[var(--lp-ink)]/85">{bullet}</span>
                </li>
              ))}
            </ul>
            <p className="lp-sans mt-4 text-[0.95rem] leading-[1.6] text-[var(--lp-ink)]/75">
              If you&rsquo;re looking for a candy brand that supports American jobs and avoids opaque supply
              chains, this is the standard to seek.
            </p>
          </div>
        </div>
      </section>

      {/* Why it matters */}
      <section className="bg-[var(--lp-cream)]" id="why">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why It Matters ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Why American-made
              <br />
              <span className="lp-script text-[var(--lp-red)]">tastes &amp; feels better.</span>
            </h2>
          </div>
          <p className="lp-sans mx-auto mb-8 max-w-[60ch] text-center text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">
            There&rsquo;s a reason customers choose American-made gummies over mass-imported candy:
            consistent quality and a cleaner ingredient expectation.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {WHY_POINTS.map((point, i) => (
              <div
                key={point.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {point.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {point.body}
                </p>
                {point.link ? (
                  <Link
                    href={point.link.href}
                    className="lp-label mt-4 inline-block text-[var(--lp-red)]"
                  >
                    {point.link.label} →
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]" id="process">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ How It&rsquo;s Made ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              How USA Gummies
              <br />
              <span className="lp-script text-[var(--lp-red)]">are made in America.</span>
            </h2>
          </div>
          <p className="lp-sans mx-auto mb-8 max-w-[60ch] text-center text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">
            USA Gummies are built on American manufacturing — from sourcing through packing.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {PROCESS_STEPS.map((step, i) => (
              <div
                key={step.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.25rem] leading-tight text-[var(--lp-ink)] sm:text-[1.4rem]">
                  {step.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {step.body}
                </p>
                {step.link ? (
                  <Link
                    href={step.link.href}
                    className="lp-label mt-4 inline-block text-[var(--lp-red)]"
                  >
                    {step.link.label} →
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bundle sizing */}
      <section className="bg-[var(--lp-cream)]" id="bundles">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Bundle Sizing ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Choose the right bundle
              <br />
              <span className="lp-script text-[var(--lp-red)]">for your moment.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {BUNDLE_USE_CASES.map((useCase, i) => (
              <div
                key={useCase.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)] sm:text-[1.45rem]">
                  {useCase.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {useCase.body}
                </p>
                <Link
                  href={useCase.link.href}
                  className="lp-label mt-4 inline-block text-[var(--lp-red)]"
                >
                  {useCase.link.label} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Internal links */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]" id="internal-links">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-2 text-[var(--lp-red)]">★ Internal Links ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            More to
            <br />
            <span className="lp-script text-[var(--lp-red)]">explore.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {INTERNAL_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="lp-cta lp-cta-light">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA cards */}
      <section className="bg-[var(--lp-cream)]" id="ctas">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Pick Your Path ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Ready when
              <br />
              <span className="lp-script text-[var(--lp-red)]">you are.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {CTA_CARDS.map((card, i) => (
              <div
                key={card.title}
                className="flex flex-col justify-between border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <p className="lp-display text-[1.2rem] leading-tight text-[var(--lp-ink)]">
                  {card.title}
                </p>
                <Link href={card.link.href} className="lp-cta mt-5 self-start" dangerouslySetInnerHTML={{ __html: card.link.label }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]" id="faqs">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Made in USA FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about American candy.</span>
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
                  {item.answer}{" "}
                  {item.link ? (
                    <Link
                      href={item.link.href}
                      className="font-semibold underline decoration-[var(--lp-red)] underline-offset-2"
                    >
                      {item.link.label}
                    </Link>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <ThreePromises />
      <SustainabilityBlock />
      <GuaranteeBlock />

      {/* Latest blog */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom line */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]" id="bottom-line">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ The Bottom Line ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            American jobs.
            <br />
            <span className="lp-script text-[var(--lp-red)]">American candy.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[60ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Choosing Made in USA candy is a simple way to back American jobs and get a cleaner, more
            consistent product. If you want gummy bears made at home with ingredients you can feel
            good about, USA Gummies is built for you.
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
