// /american-candy-gifts — gifting funnel page in LP design language.
// Structure: PageHero → ScarcityBar → Highlights grid → Gift ideas grid →
// Why-gift list → BagSlider (client) → FAQ accordion → ThreePromises →
// GuaranteeBlock → bottom CTA.
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
const PAGE_TITLE = "American-Made Candy Gifts | USA Gummies Gift Ideas";
const PAGE_DESCRIPTION =
  "Looking for American-made candy gifts? USA Gummies are made in the USA with no artificial dyes. Perfect for birthdays, holidays, care packages, and corporate gifts. Free shipping on every order.";
const PAGE_URL = `${SITE_URL}/american-candy-gifts`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "American-Made Candy Gifts";

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
    body: "Sourced, made, and packed domestically. A gift you can feel proud to give.",
  },
  {
    title: "No Artificial Dyes",
    body: "Colors from fruit and vegetable extracts. A candy gift they can feel good about.",
  },
  {
    title: "5 Classic Flavors",
    body: "Cherry, watermelon, orange, green apple, and lemon. Something for everyone.",
  },
];

const GIFT_IDEAS = [
  {
    title: "Birthday & Holiday Gifts",
    body: "A sweet surprise for any celebration. Gummy bears are a crowd-pleaser at birthday parties, stocking stuffers, Easter baskets, and Valentine's Day treats.",
  },
  {
    title: "Care Packages & Military Mail",
    body: "Shelf-stable and easy to ship. Perfect for college care packages, deployed military members, or a just-because gift to brighten someone's day.",
  },
  {
    title: "Corporate & Team Gifts",
    body: "Impress clients, reward employees, or stock the break room. Bundle pricing makes it easy to order for the whole team.",
  },
];

const WHY_GIFT = [
  "Quality packaging that looks great out of the box. No extra wrapping needed.",
  "Bundle savings when you order 5 or more bags, ideal for gifting to multiple people.",
  "Ships fast from the USA so your gift arrives on time.",
];

const FAQS = [
  {
    question: "Can I ship a gift directly to someone else?",
    answer:
      "Yes. At checkout you can enter a different shipping address from your billing address, so your gift ships straight to the recipient.",
  },
  {
    question: "Do you offer bulk ordering for events or corporate gifts?",
    answer:
      "Absolutely. Our bundle pricing already saves you more per bag at higher quantities. For very large orders (50+ bags), email us at hello@usagummies.com for a custom quote.",
  },
  {
    question: "What is the shelf life of USA Gummies?",
    answer:
      "Each bag has a best-by date printed on it, typically 12 months from production. Gummy bears are shelf-stable and do not need refrigeration.",
  },
  {
    question: "Do you offer gift wrapping?",
    answer:
      "We do not offer gift wrapping at this time, but the bags are colorful and presentation-ready right out of the box.",
  },
  {
    question: "How long does shipping take?",
    answer:
      "Most orders ship within 1-2 business days and arrive in 3-5 business days via USPS. Free shipping is included on every order.",
  },
  {
    question: "Are USA Gummies a good gift for kids?",
    answer:
      "Yes. Our gummy bears use no artificial dyes and all natural flavors, making them a candy gift parents can feel good about.",
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

export default function AmericanCandyGiftsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "American Candy Gifts", href: "/american-candy-gifts" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="American-Made Candy Gifts"
        headline="American-made"
        scriptAccent="candy gifts."
        sub="Made in the USA with no artificial dyes and all-natural flavors. Great for birthdays, holidays, care packages, corporate gifts, and anyone who loves classic gummy bears."
        ctas={[
          { href: "/shop", label: "Shop gift bundles" },
          { href: "/ingredients", label: "See ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Highlights */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why USA Gummies ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three reasons
              <br />
              <span className="lp-script text-[var(--lp-red)]">to gift the bag.</span>
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

      {/* Gift ideas */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Gift Ideas ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              The perfect gift,
              <br />
              <span className="lp-script text-[var(--lp-red)]">for every occasion.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {GIFT_IDEAS.map((idea, i) => (
              <div
                key={idea.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)] sm:text-[1.45rem]">
                  {idea.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {idea.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why-gift list + BagSlider client */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ A Gift That Stands Out ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Why people
              <br />
              <span className="lp-script text-[var(--lp-red)]">choose USA Gummies.</span>
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <ul className="grid gap-4">
              {WHY_GIFT.map((tip, i) => (
                <li
                  key={tip}
                  className="flex items-start gap-4 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                  style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
                >
                  <span className="lp-display mt-1 text-[1.4rem] leading-none text-[var(--lp-red)]">★</span>
                  <span className="lp-sans text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">{tip}</span>
                </li>
              ))}
              <li className="lp-sans text-[0.85rem] leading-[1.5] text-[var(--lp-ink)]/65">
                All orders include tracking so you know exactly when your gift arrives.
              </li>
            </ul>
            <div
              id="gift-bundle-buy"
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Shop Gift Bundles ★</p>
              <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Start with 5 bags for the best gift-bundle value.
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
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Candy Gift FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about gifting.</span>
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
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Gift ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Shop the bundle,
            <br />
            <span className="lp-script text-[var(--lp-red)]">send the smile.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Save more per bag when you add 5+ bags. {FREE_SHIPPING_PHRASE}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop &amp; save
            </Link>
            <Link href="/gummy-gift-bundles" className="lp-cta lp-cta-light">
              Gift bag options
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
