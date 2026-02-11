import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { BRAND_STORY_SHORT } from "@/data/brandStory";

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
const PAGE_TITLE = "USA Gummies FAQ | Dye-Free Gummies";
const PAGE_DESCRIPTION =
  "Got questions about dye-free gummies? Find answers on ingredients, Red 40, shipping, allergens, bulk orders, and more. 34 questions answered.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/faq` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/faq`,
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

type FaqItem = {
  question: string;
  answer: string;
  answerText?: string;
  answerNode?: ReactNode;
};

const FAQS: FaqItem[] = [
  {
    question: "Are USA Gummies gluten-free?",
    answer:
      "We do not make a gluten-free claim. Please review the ingredient panel on the bag for the most current allergen details. If you have sensitivities, contact us before ordering.",
  },
  {
    question: "Do your gummy bears contain artificial dyes or synthetic colors?",
    answer:
      "No. USA Gummies are made with no artificial dyes or synthetic colors, and colors come from real fruit and vegetable extracts.",
  },
  {
    question: "Where are USA Gummies made?",
    answer:
      "Our All American gummy bears are sourced, made, and packed right here in the USA.",
  },
  {
    question: "What is the USA Gummies story?",
    answer: BRAND_STORY_SHORT.join(" "),
    answerText: `${BRAND_STORY_SHORT.join("\n\n")}\n\nRead the full story`,
    answerNode: (
      <div className="space-y-2">
        {BRAND_STORY_SHORT.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <Link href="/about" className="link-underline font-semibold text-[var(--navy)]">
          Read the full story
        </Link>
      </div>
    ),
  },
  {
    question: "What flavors are in the bag?",
    answer:
      "Every 7.5 oz bag includes five fruit flavors: cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "How long do the gummies last?",
    answer:
      "Each bag is stamped with a best-by date. For the freshest chew, enjoy your gummies before that date and store them in a cool, dry place.",
  },
  {
    question: "Can I buy a single bag?",
    answer:
      "Yes. You can order 1-3 bags on our site at standard price, or save more per bag on 4+ bags.",
  },
  {
    question: "How do bag count savings work?",
    answer:
      `Savings pricing lowers the per-bag cost as you add more bags. Most customers choose 5, 8, or 12 bags, and ${FREE_SHIPPING_PHRASE.toLowerCase()}.`,
  },
  {
    question: "Which bag count should I choose?",
    answer:
      "Use our bag count guides or gummy calculator to match the right size for gifts, patriotic parties, or bulk orders.",
    answerText:
      "Use our bag count guides or gummy calculator to match the right size for gifts, patriotic parties, or bulk orders.",
    answerNode: (
      <>
        Use our{" "}
        <Link href="/gummy-calculator" className="link-underline font-semibold text-[var(--navy)]">
          gummy calculator
        </Link>{" "}
        or bag count guides for{" "}
        <Link href="/gummy-gift-bundles" className="link-underline font-semibold text-[var(--navy)]">
          gifts
        </Link>
        ,{" "}
        <Link
          href="/patriotic-party-snacks"
          className="link-underline font-semibold text-[var(--navy)]"
        >
          patriotic parties
        </Link>
        , or{" "}
        <Link href="/bulk-gummy-bears" className="link-underline font-semibold text-[var(--navy)]">
          bulk orders
        </Link>
        .
      </>
    ),
  },
  // --- Ingredients & Dietary ---
  {
    question: "Are USA Gummies vegan?",
    answer:
      "No. USA Gummies contain gelatin, which is an animal-derived ingredient. They are not suitable for vegan diets.",
  },
  {
    question: "Do USA Gummies contain gelatin?",
    answer:
      "Yes. Our gummy bears use gelatin for the classic gummy chew texture. Check the ingredients page for the full ingredient list.",
  },
  {
    question: "Are your gummies kosher or halal?",
    answer:
      "We do not currently carry kosher or halal certification. Please review the ingredient panel for details.",
  },
  {
    question: "Do USA Gummies contain any of the top allergens?",
    answer:
      "Please review the ingredient panel on the bag for the most current allergen information. If you have specific allergies, contact us before ordering.",
  },
  {
    question: "What gives USA Gummies their color?",
    answer:
      "Colors come from fruit and vegetable extracts, spirulina, and curcumin. No FD&C certified synthetic colors are used.",
  },
  {
    question: "Are USA Gummies organic?",
    answer:
      "We do not carry an organic certification. Our gummies are made with all natural flavors and colors from fruit and vegetable extracts in an FDA-registered facility.",
  },
  {
    question: "How many calories are in a serving of USA Gummies?",
    answer:
      "Visit our ingredients page for the most current nutrition facts, including calories, sugar, and serving size information.",
  },
  {
    question: "What does dye-free mean?",
    answer:
      "Dye-free means the product does not use FD&C certified synthetic color additives like Red 40, Yellow 5, or Blue 1. Colors come from natural sources like fruit and vegetable extracts.",
  },
  // --- Shipping & Orders ---
  {
    question: "How long does shipping take?",
    answer:
      "Orders of 5+ bags ship directly from us via USPS and typically arrive in 3-5 business days. Orders under 5 bags are fulfilled through Amazon with their standard delivery timeline.",
  },
  {
    question: "Do you ship internationally?",
    answer:
      "We currently ship within the United States only. We hope to offer international shipping in the future.",
  },
  {
    question: "Can I track my order?",
    answer:
      "Yes. You will receive a tracking number by email once your order ships. For Amazon-fulfilled orders, tracking is available in your Amazon account.",
  },
  {
    question: "What is your return policy?",
    answer:
      "As a food product, we do not accept returns. If you receive a damaged or incorrect order, contact us within 7 days and we will make it right.",
  },
  {
    question: "Why does buying under 5 bags go through Amazon?",
    answer:
      "Shipping small orders directly is expensive. By routing 1-4 bag orders through Amazon, you benefit from their shipping infrastructure and competitive delivery rates. Orders of 5+ bags ship free directly from us.",
  },
  // --- Product & Quality ---
  {
    question: "How many gummy bears are in each bag?",
    answer:
      "Each 7.5 oz bag contains approximately 50 gummy bears across five fruit flavors.",
  },
  {
    question: "What does FDA-registered facility mean?",
    answer:
      "Our manufacturing facility is registered with the U.S. Food and Drug Administration. This means the facility meets federal food safety standards and is subject to FDA oversight.",
  },
  {
    question: "Are USA Gummies made in China?",
    answer:
      "No. USA Gummies are sourced, made, and packed in the United States. Our name reflects our commitment to domestic manufacturing.",
  },
  {
    question: "Can kids eat USA Gummies?",
    answer:
      "Yes. USA Gummies are made with no artificial dyes or synthetic colors, making them a popular choice for parents looking for cleaner candy options. As with any candy, parental discretion is advised for small children.",
  },
  {
    question: "Do you offer sugar-free gummy bears?",
    answer:
      "We do not currently offer a sugar-free variety. Our gummies are made with real sugar and all natural flavors.",
  },
  {
    question: "How should I store my gummy bears?",
    answer:
      "Store in a cool, dry place away from direct sunlight. Reseal the bag after opening to maintain freshness and texture.",
  },
  // --- Buying & Gifting ---
  {
    question: "Can I buy USA Gummies as a gift?",
    answer:
      "Yes. Our gummy bundles make great gifts. Check our gummy gift bundles guide for recommendations by occasion.",
    answerNode: (
      <>
        Yes. Our gummy bundles make great gifts. Check our{" "}
        <Link href="/gummy-gift-bundles" className="link-underline font-semibold text-[var(--navy)]">
          gummy gift bundles guide
        </Link>{" "}
        for recommendations by occasion.
      </>
    ),
  },
  {
    question: "Do you offer wholesale or bulk pricing?",
    answer:
      "Yes. We offer wholesale pricing for retailers, corporate gifting, and events. Visit our wholesale page or contact us for details.",
    answerNode: (
      <>
        Yes. We offer wholesale pricing for retailers, corporate gifting, and events. Visit our{" "}
        <Link href="/wholesale" className="link-underline font-semibold text-[var(--navy)]">
          wholesale page
        </Link>{" "}
        or{" "}
        <Link href="/contact" className="link-underline font-semibold text-[var(--navy)]">
          contact us
        </Link>{" "}
        for details.
      </>
    ),
  },
  {
    question: "How many bags do I need for a party?",
    answer:
      "Use our free gummy calculator to get a personalized recommendation based on your guest count and event type.",
    answerNode: (
      <>
        Use our free{" "}
        <Link href="/gummy-calculator" className="link-underline font-semibold text-[var(--navy)]">
          gummy calculator
        </Link>{" "}
        to get a personalized recommendation based on your guest count and event type.
      </>
    ),
  },
  {
    question: "Can I subscribe for regular deliveries?",
    answer:
      "We are building a subscription option for repeat customers. Join our email list to be notified when it launches.",
  },
  {
    question: "Do you sell on Amazon?",
    answer:
      "Yes. USA Gummies are available on Amazon. Orders of 1-4 bags on our site are fulfilled through Amazon to give you the best shipping experience.",
  },
  {
    question: "Is there a discount for first-time buyers?",
    answer:
      "Sign up for our email list to receive exclusive offers for new customers. Bundle savings also start at 4+ bags with the best per-bag price at 12 bags.",
  },
  // --- Comparison / Search Intent ---
  {
    question: "What is the difference between dye-free and natural gummies?",
    answer:
      "Dye-free specifically means no synthetic FD&C color additives. Natural gummies may or may not contain synthetic colors. USA Gummies are both dye-free and made with all natural flavors.",
  },
  {
    question: "Are USA Gummies better than regular gummy bears?",
    answer:
      "USA Gummies use fruit and vegetable-based colors instead of synthetic dyes like Red 40, and they are made in the USA in an FDA-registered facility. The taste is a classic fruit gummy bear chew with all natural flavors.",
  },
  {
    question: "What is Red 40 and why should I avoid it?",
    answer:
      "Red 40 (also called FD&C Red No. 40 or Allura Red) is a synthetic color additive used in many candies. Some parents choose to avoid it due to concerns about sensitivity in certain children. USA Gummies use fruit and vegetable extracts for color instead.",
    answerNode: (
      <>
        Red 40 (also called FD&C Red No. 40 or Allura Red) is a synthetic color additive used in many candies. Some parents choose to avoid it due to concerns about sensitivity in certain children. USA Gummies use fruit and vegetable extracts for color instead.{" "}
        <Link href="/no-artificial-dyes-gummy-bears" className="link-underline font-semibold text-[var(--navy)]">
          Learn more
        </Link>
        .
      </>
    ),
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
      text: item.answerText ?? item.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy">
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
              { name: "FAQ", href: "/faq" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                FAQ
              </div>
              <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                USA Gummies FAQ
              </h1>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Quick answers about our All American gummy bears, ingredients, flavor notes, bag count
                savings, and where to buy.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop USA Gummies
                </Link>
                <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {FAQS.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                    <span>{item.question}</span>
                    <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-2 text-sm text-[var(--muted)]">
                    {item.answerNode ?? item.answer}
                  </div>
                </details>
              ))}
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Still have questions?
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">We are here to help.</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Need ingredient details or order help? Send a note and we will respond within one
                business day.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href="/contact" className="btn btn-outline">
                  Contact support
                </Link>
                <Link href="/about" className="btn btn-candy">
                  Learn our story
                </Link>
              </div>
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Keep reading
              </div>
              <h2 className="mt-2 text-lg font-black text-[var(--text)]">
                More about USA Gummies.
              </h2>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <Link href="/no-artificial-dyes-gummy-bears" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Dye-free gummy bears
                </Link>
                <Link href="/made-in-usa" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Made in USA
                </Link>
                <Link href="/ingredients" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Ingredients
                </Link>
                <Link href="/dye-free-candy" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Dye-free candy guide
                </Link>
                <Link href="/gummies-101" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Gummies 101
                </Link>
                <Link href="/wholesale" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Wholesale
                </Link>
                <Link href="/gummy-calculator" className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                  Gummy calculator
                </Link>
              </div>
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Ready to order
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Shop the best value bundles.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
              </p>
              <div className="mt-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop best value
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
