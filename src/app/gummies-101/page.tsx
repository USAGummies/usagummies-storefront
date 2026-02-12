import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
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
const PAGE_TITLE = "Gummies 101 | Dye-Free Gummies Guide";
const PAGE_DESCRIPTION =
  "Learn about gummy ingredients, textures, and flavors, plus why we skip artificial dyes in our made in USA candy.";
const PAGE_URL = `${SITE_URL}/gummies-101`;
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

const FAQS = [
  {
    question: "Are USA Gummies made in the USA?",
    answer:
      "Yes. USA Gummies are sourced, made, and packed in the USA at FDA-registered facilities.",
  },
  {
    question: "Do USA Gummies use artificial dyes?",
    answer:
      "No. Colors come from fruit and vegetable extracts. No artificial dyes or synthetic colors.",
  },
  {
    question: "What flavors are in each bag?",
    answer:
      "Cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "Where should I buy 1-4 bags?",
    answer:
      "For small orders, Amazon is the fastest option. On-site bundles start at 5 bags with free shipping.",
  },
  {
    question: "How does bundle pricing work?",
    answer:
      "Savings start at 4 bags, free shipping begins at 5+ bags, and the best per-bag price is at 12 bags.",
  },
  {
    question: "What is America 250?",
    answer:
      "America 250 is a USA Gummies hub for patriotic gifts, events, and limited drops tied to America's 250th.",
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

export default function Gummies101Page() {
  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Gummies 101", href: "/gummies-101" },
          ]}
        />

        <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            USA Gummies facts
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Gummies 101
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)] max-w-prose">
            The quick reference for buyers, gift planners, and America 250 supporters.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Quick facts
              </div>
              <ul className="mt-3 space-y-2 text-sm text-[var(--text)]">
                <li>Made in the USA</li>
                <li>No artificial dyes</li>
                <li>All natural flavors</li>
                <li>7.5 oz bag</li>
                <li>Fast, reliable shipping</li>
                <li>{FREE_SHIPPING_PHRASE}</li>
                <li>Bundles start at 5 bags</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                Best places to start
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/shop" className="btn btn-candy">
                  Shop bundles
                </Link>
                <Link href="/gummy-gift-bundles" className="btn btn-outline">
                  Gift bundles
                </Link>
                <Link href="/america-250" className="btn btn-outline">
                  America 250
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-[0.9fr_1.1fr] sm:items-center">
              <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                <Image
                  src="/brand/usa-gummies-family.webp"
                  alt="Assorted USA Gummies gummy bear bags"
                  fill
                  sizes="(max-width: 768px) 90vw, 360px"
                  className="object-contain"
                />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  What you are getting
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Classic gummy bear flavor with a clean ingredient list, made in the USA and packed
                  for gifting or bulk orders.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="badge badge--navy">All natural flavors</span>
                  <span className="badge badge--navy">No artificial dyes</span>
                  <span className="badge badge--navy">7.5 oz bag</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Flavor lineup
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Cherry, watermelon, orange, green apple, and lemon - classic gummy bear flavor without
              artificial dyes.
            </p>
            <Link
              href="/ingredients"
              className="mt-3 inline-flex text-xs font-semibold text-[var(--navy)] link-underline"
            >
              See ingredients
            </Link>
            <Link
              href="/no-artificial-dyes-gummy-bears"
              className="mt-2 inline-flex text-xs font-semibold text-[var(--navy)] link-underline"
            >
              Red 40 Free Gummies
            </Link>
          </div>

          <div className="mt-6 grid gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Frequently asked
            </div>
            <div className="space-y-2">
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
          </div>
        </div>
      </div>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Keep exploring
            </div>
            <h2 className="mt-2 text-lg font-black text-[var(--text)]">
              More about USA Gummies.
            </h2>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Link href="/dye-free-candy" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Dye-free candy guide
              </Link>
              <Link href="/made-in-usa" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Made in USA
              </Link>
              <Link href="/about" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                About us
              </Link>
              <Link href="/bulk-gummy-bears" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Bulk gummy bears
              </Link>
              <Link href="/patriotic-candy" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Patriotic candy
              </Link>
              <Link href="/wholesale" className="rounded-xl border border-[rgba(15,27,45,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Wholesale
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
