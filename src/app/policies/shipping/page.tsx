import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";

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
const PAGE_TITLE = "Shipping Policy";
const PAGE_DESCRIPTION =
  "Shipping details for USA Gummies orders, delivery times, and carrier info for made in USA candy.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/policies/shipping` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/policies/shipping`,
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

const SECTIONS = [
  {
    title: "Free shipping",
    body:
      "Free shipping on every order — no minimum, no hidden fees. The product page and cart show $0 shipping at checkout for any quantity.",
  },
  {
    title: "Processing time",
    body:
      "Orders ship within 24 hours. If an order is placed after the daily carrier pickup time or on weekends/holidays, it ships the next business day. We prep and label orders within 24 hours.",
  },
  {
    title: "Delivery time",
    body:
      "Delivery speed depends on the carrier and destination. Most customers receive orders within 2–7 business days after shipment.",
  },
  {
    title: "Tracking",
    body: "Tracking details are sent within 24 hours of your order.",
  },
  {
    title: "Shipping issues",
    body:
      "If your package is delayed, missing, or arrives damaged, contact us using the form below. We'll make it right.",
  },
];

export default function ShippingPolicyPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: "Shipping", href: "/policies/shipping" },
        ]}
      />

      <PageHero
        eyebrow="Policies"
        headline="Shipping"
        scriptAccent="policy."
        sub="Orders ship within 24 hours, with tracking sent fast. Free shipping on every order."
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="lp-sans space-y-6 text-[1.02rem] leading-[1.7] text-[var(--lp-ink)]/88">
            {SECTIONS.map((section) => (
              <div key={section.title} className="border-b-2 border-[var(--lp-ink)]/15 pb-6 last:border-b-0">
                <h2 className="lp-display text-[1.5rem] text-[var(--lp-ink)]">{section.title}</h2>
                <p className="mt-3">{section.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Get In Touch ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Shipping
              <br />
              <span className="lp-script text-[var(--lp-red)]">questions?</span>
            </h2>
            <p className="lp-sans mx-auto mt-4 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
              Send a message and we&rsquo;ll respond within one business day.
            </p>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <ContactForm context="Shipping Policy Question" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Browse the Lineup ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Shop all-natural
            <br />
            <span className="lp-script text-[var(--lp-red)]">USA Gummies.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/policies" className="lp-cta lp-cta-light">
              All policies
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
