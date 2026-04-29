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
const PAGE_TITLE = "Terms of Service | USA Gummies";
const PAGE_DESCRIPTION =
  "Terms and conditions for using USA Gummies and purchasing made in USA candy.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/policies/terms` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/policies/terms`,
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
    title: "Orders",
    body:
      "By placing an order, you agree that the information you provide is accurate and that you are authorized to use the selected payment method.",
  },
  {
    title: "Pricing",
    body:
      "Prices are shown in your cart at checkout. Savings pricing and shipping eligibility (including Free shipping on every order) are displayed clearly before you purchase.",
  },
  {
    title: "Checkout & payments",
    body:
      "Checkout is powered by Shopify. Payment details are processed securely by Shopify and related providers.",
  },
  {
    title: "Site use",
    body:
      "You agree not to misuse the site, attempt unauthorized access, or disrupt site operations.",
  },
  {
    title: "Changes",
    body:
      "We may update these terms from time to time. The latest version will always be posted on this page.",
  },
];

export default function TermsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: "Terms", href: "/policies/terms" },
        ]}
      />

      <PageHero
        eyebrow="Policies"
        headline="Terms of"
        scriptAccent="service."
        sub="These terms apply to purchases made through USA Gummies. Checkout is processed securely through Shopify."
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
              Terms
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
            <ContactForm context="Terms of Service Question" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Shop the Lineup ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            American-made
            <br />
            <span className="lp-script text-[var(--lp-red)]">gummy bears.</span>
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
