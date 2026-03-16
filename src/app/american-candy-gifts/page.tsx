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
const PAGE_TITLE = "American-Made Candy Gifts | USA Gummies Gift Ideas";
const PAGE_DESCRIPTION =
  "Looking for American-made candy gifts? USA Gummies are made in the USA with no artificial dyes. Perfect for birthdays, holidays, care packages, and corporate gifts. Free shipping on 5+ bags.";
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
      "Most orders ship within 1-2 business days and arrive in 3-5 business days via USPS. Free shipping kicks in at 5+ bags.",
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
              { name: "American Candy Gifts", href: "/american-candy-gifts" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  American-made candy gifts
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  American-Made Candy Gifts
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Looking for the perfect American candy gift? USA Gummies are made in the USA
                  with no artificial dyes and all natural flavors. Great for birthdays, holidays,
                  care packages, corporate gifts, and anyone who loves classic gummy bears.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop gift bundles
                  </Link>
                  <Link href="/ingredients" className="btn btn-outline">
                    See ingredients
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
                  <span className="candy-pill">American-made</span>
                  <span className="candy-pill">No artificial dyes</span>
                  <span className="candy-pill">Great for gifting</span>
                  <span className="candy-pill">All natural flavors</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="USA Gummies gummy bear bags — perfect American candy gift"
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
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">Gift-ready</span>
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
                Gift ideas
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                The perfect candy gift for every occasion.
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {GIFT_IDEAS.map((item) => (
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
                    Why choose USA Gummies as a gift
                  </div>
                  <h2 className="mt-2 text-xl font-black text-[var(--text)]">
                    A candy gift that stands out.
                  </h2>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    {WHY_GIFT.map((tip) => (
                      <li key={tip} className="flex items-start gap-2">
                        <span className="mt-2 h-2 w-2 rounded-full bg-[var(--gold)]" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-xs text-[var(--muted)]">
                    All orders include tracking so you know exactly when your gift arrives.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4" id="gift-bundle-buy">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Shop candy gift bundles
                </div>
                <div className="mt-2 text-sm text-[var(--muted)]">
                  Start with 5 bags for the best gift bundle value. {FREE_SHIPPING_PHRASE}
                </div>
                <div className="mt-4">
                  <BagSlider variant="full" defaultQty={5} />
                </div>
              </div>
            </div>

            <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Candy gift FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Quick answers about gifting USA Gummies.
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
                  Ready to gift
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  Shop the best value gift bundles.
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Save more per bag when you add 5+ bags. {FREE_SHIPPING_PHRASE}.
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
