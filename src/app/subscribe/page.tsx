import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { SubscribeForm } from "./SubscribeForm.client";

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
const PAGE_TITLE = "Subscribe & Save | USA Gummies Delivered on Your Schedule";
const PAGE_DESCRIPTION =
  "Subscribe to USA Gummies and save $0.50/bag below bundle pricing. Choose your quantity and frequency — free shipping on every delivery. Cancel anytime.";
const PAGE_URL = `${SITE_URL}/subscribe`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

const STEPS = [
  { num: "1", title: "Choose your quantity", desc: "Pick 5, 8, or 12 bags per delivery." },
  { num: "2", title: "Pick your frequency", desc: "Monthly, every 6 weeks, or bi-monthly." },
  { num: "3", title: "Auto-delivered", desc: "We ship on schedule. Pause or cancel anytime." },
];

const FAQS = [
  {
    question: "How do I cancel my subscription?",
    answer: "You can cancel anytime from your subscription management page. No fees, no hassle.",
  },
  {
    question: "Can I change my quantity or frequency?",
    answer: "Yes. Visit your subscription management page to update your quantity, frequency, or pause your subscription.",
  },
  {
    question: "When am I charged?",
    answer: "You'll receive a checkout link before each delivery. You're only charged when you complete checkout.",
  },
  {
    question: "Is shipping free for subscribers?",
    answer: "Yes. All subscriptions include free shipping on every delivery (minimum 5 bags).",
  },
  {
    question: "What's the minimum subscription quantity?",
    answer: "The minimum subscription is 5 bags per delivery.",
  },
  {
    question: "How much do I save with a subscription?",
    answer: "Subscribers save $0.50 per bag below our bundle pricing. For example, a 5-bag subscription is $4.50/bag instead of $5.00/bag — that's $2.50 saved per delivery.",
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

export default function SubscribePage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(45,122,58,0.12), transparent 48%), radial-gradient(circle at 85% 5%, rgba(199,166,98,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Subscribe & Save", href: "/subscribe" },
            ]}
          />

          {/* Hero */}
          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-center max-w-2xl mx-auto">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                Subscribe &amp; save
              </div>
              <h1 className="mt-3 text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                Gummies Delivered on Your Schedule
              </h1>
              <p className="mt-4 text-sm text-[var(--muted)] sm:text-base max-w-prose mx-auto">
                Save <strong className="text-[var(--text)]">$0.50 per bag</strong> below our
                bundle pricing. Choose your quantity, pick your frequency, and
                we&rsquo;ll handle the rest. Free shipping on every delivery. Cancel anytime.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-[11px] font-semibold text-[var(--muted)]">
                <span className="candy-pill">Cancel anytime</span>
                <span className="candy-pill">Free shipping</span>
                <span className="candy-pill">Save $0.50/bag</span>
                <span className="candy-pill">Made in USA</span>
              </div>
            </div>

            {/* How it works */}
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.num} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#2D7A3A] text-white text-sm font-bold">
                    {step.num}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-[var(--text)]">{step.title}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{step.desc}</div>
                </div>
              ))}
            </div>

            {/* Subscription Form (client component) */}
            <div className="mt-8">
              <SubscribeForm />
            </div>

            {/* Trust signals */}
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              {[
                { icon: "\uD83C\uDDFA\uD83C\uDDF8", text: "Made in the USA" },
                { icon: "\uD83D\uDE9A", text: "Free shipping always" },
                { icon: "\u23F8\uFE0F", text: "Pause or cancel anytime" },
                { icon: "\u2B50", text: "4.8 stars from verified buyers" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-xs font-semibold text-[var(--text)]">
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>

            {/* FAQ */}
            <div className="mt-8">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Subscription FAQs
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Common questions about subscribing.
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

          {/* Bottom CTA */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Prefer a one-time purchase?
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  Shop our bundle deals.
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Save per bag with bundles. Free shipping on 5+ bags.
                </p>
              </div>
              <Link href="/shop" className="btn btn-candy">
                Shop bundles
              </Link>
            </div>
          </div>
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </main>
  );
}
