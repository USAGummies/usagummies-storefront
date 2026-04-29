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
const PAGE_TITLE = "Policies | USA Gummies";
const PAGE_DESCRIPTION =
  "Review policies for orders, shipping, returns, and privacy for USA Gummies made in USA candy.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/policies` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/policies`,
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

const POLICIES = [
  {
    href: "/policies/shipping",
    title: "Shipping Policy",
    desc: "Processing times, delivery expectations, and tracking. Free shipping on every order.",
  },
  {
    href: "/policies/returns",
    title: "Satisfaction Guarantee",
    desc: "Food-safety rules, damaged/incorrect orders, and how we make it right.",
  },
  {
    href: "/policies/privacy",
    title: "Privacy Policy",
    desc: "What we collect, how it's used, and how Shopify checkout protects payments.",
  },
  {
    href: "/policies/terms",
    title: "Terms of Service",
    desc: "General terms for using the site and purchasing through Shopify checkout.",
  },
];

export default function PoliciesIndexPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
        ]}
      />

      <PageHero
        eyebrow="Policies"
        headline="Customer-first"
        scriptAccent="policies."
        sub="Clear policies covering shipping, satisfaction guarantee, privacy, and terms of service so checkout stays simple and expectations stay transparent."
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {POLICIES.map((p, i) => (
              <Link
                key={p.href}
                href={p.href}
                className="group block border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 no-underline sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h2 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)] group-hover:text-[var(--lp-red)] sm:text-[1.7rem]">
                  {p.title}
                </h2>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {p.desc}
                </p>
                <p className="lp-label mt-4 text-[var(--lp-red)]">View policy →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Need Help? ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Send a
              <br />
              <span className="lp-script text-[var(--lp-red)]">message.</span>
            </h2>
            <p className="lp-sans mx-auto mt-4 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
              We respond within one business day.
            </p>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <ContactForm context="Policies Index Question" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            All-natural
            <br />
            <span className="lp-script text-[var(--lp-red)]">gummy bears.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/help" className="lp-cta lp-cta-light">
              Help center
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
