import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { GummyCalculator } from "@/components/guides/GummyCalculator.client";
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
const PAGE_TITLE = "Gummy Bear Calculator — How Many Bags Do I Need?";
const PAGE_DESCRIPTION =
  "Use our free gummy bear calculator to find the right bag count for your party, event, or gift list. Dye-free gummies made in the USA.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/gummy-calculator` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/gummy-calculator`,
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

const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to calculate how many gummy bear bags you need",
  description: PAGE_DESCRIPTION,
  step: [
    {
      "@type": "HowToStep",
      name: "Enter your guest count",
      text: "Input the number of people attending your party, event, or receiving gifts.",
    },
    {
      "@type": "HowToStep",
      name: "Select your event type",
      text: "Choose from party, wedding, gift bags, office, or classroom to get a serving estimate per guest.",
    },
    {
      "@type": "HowToStep",
      name: "See your recommendation",
      text: "The calculator shows the recommended bag count, per-bag price, total cost, and shipping info.",
    },
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How many gummy bears are in a bag?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Each 7.5 oz bag of USA Gummies contains approximately 50 gummy bears in 5 fruit flavors.",
      },
    },
    {
      "@type": "Question",
      name: "How many gummy bear bags do I need for a party?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "For a party, plan for about 12 gummies per guest. A party of 20 guests needs roughly 5 bags. Use our calculator above for an exact recommendation.",
      },
    },
    {
      "@type": "Question",
      name: "Do I get free shipping on gummy bear orders?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Orders of 5 or more bags ship free directly from us. Under 5 bags, we redirect you to Amazon for fast, affordable shipping.",
      },
    },
  ],
};

export default function GummyCalculatorPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 15%, rgba(255,199,44,0.12), transparent 48%), radial-gradient(circle at 80% 10%, rgba(239,59,59,0.10), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Bundle Guides", href: "/bundle-guides" },
              { name: "Gummy Calculator", href: "/gummy-calculator" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
              Free gummy calculator
            </div>
            <h1 className="mt-2 text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
              How many bags of gummy bears do I need?
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
              Enter your guest count and event type to get a personalized recommendation.
              Dye-free gummies made in the USA with no artificial colors.
            </p>

            <div className="mt-6">
              <GummyCalculator />
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Common questions
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Gummy bear calculator FAQ
            </h2>
            <div className="mt-4 space-y-2">
              {(faqJsonLd.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).map((item) => (
                <details
                  key={item.name}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                    <span>{item.name}</span>
                    <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-2 text-sm text-[var(--muted)]">{item.acceptedAnswer.text}</div>
                </details>
              ))}
            </div>
          </div>

          {/* Cross-links */}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              More guides
            </div>
            <h2 className="mt-2 text-lg font-black text-[var(--text)]">
              Planning tips for dye-free gummies.
            </h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/bundle-guides" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Bundle guides
              </Link>
              <Link href="/gummy-gift-bundles" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Gift bag options
              </Link>
              <Link href="/patriotic-party-snacks" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Party snack ideas
              </Link>
              <Link href="/bulk-gummy-bears" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Bulk gummy bears
              </Link>
              <Link href="/shop" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Shop & save
              </Link>
              <Link href="/wholesale" className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-all hover:shadow-[0_8px_20px_rgba(15,27,45,0.08)] hover:-translate-y-0.5">
                Wholesale inquiries
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

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </main>
  );
}
