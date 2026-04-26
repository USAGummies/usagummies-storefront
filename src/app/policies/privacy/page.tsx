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
const PAGE_TITLE = "Privacy Policy | USA Gummies";
const PAGE_DESCRIPTION =
  "Read how USA Gummies handles data, privacy, and security for shoppers of our dye-free gummies.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/policies/privacy` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/policies/privacy`,
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
    title: "What we collect",
    body:
      "When you place an order, we collect information required to fulfill it, such as your name, shipping address, email, and order details.",
  },
  {
    title: "How we use it",
    body:
      "We use your information to process orders, provide updates, respond to support requests, and improve the site experience.",
  },
  {
    title: "Payments",
    body:
      "Payment information is processed securely through Shopify checkout. We do not store your full payment card details on our servers.",
  },
  {
    title: "Cookies",
    body:
      "We may use cookies and similar technologies to support site functionality and understand how visitors use the site.",
  },
  {
    title: "Contact",
    body: "If you have privacy questions, contact us using the form below.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: "Privacy", href: "/policies/privacy" },
        ]}
      />

      <PageHero
        eyebrow="Policies"
        headline="Privacy"
        scriptAccent="policy."
        sub="We only use information needed to process your order and improve your experience. Payments are handled securely through Shopify checkout."
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
              Privacy
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
            <ContactForm context="Privacy Policy Question" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Explore the
            <br />
            <span className="lp-script text-[var(--lp-red)]">shop.</span>
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
