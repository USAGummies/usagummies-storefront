import type { Metadata } from "next";
import Link from "next/link";
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
const PAGE_TITLE = "Help Center | USA Gummies";
const PAGE_DESCRIPTION =
  "Get support for orders, shipping, and products. Find info on made in USA candy and dye-free gummies.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/help` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/help`,
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

const SUPPORT_LINKS = [
  {
    title: "FAQ",
    copy: "Quick answers about bag counts, pricing, and ingredients.",
    href: "/faq",
  },
  {
    title: "Shipping Policy",
    copy: "Delivery timelines, tracking, and free shipping details.",
    href: "/policies/shipping",
  },
  {
    title: "Satisfaction Guarantee",
    copy: "Food-safety guidelines, damaged orders, and how we make it right.",
    href: "/policies/returns",
  },
  {
    title: "Ingredients",
    copy: "All-natural flavors, no artificial dyes, and label details.",
    href: "/ingredients",
  },
  {
    title: "Made in USA",
    copy: "How we source, pack, and ship entirely in America.",
    href: "/made-in-usa",
  },
  {
    title: "Wholesale",
    copy: "Bulk and retail inquiries for USA Gummies partners.",
    href: "/wholesale",
  },
];

export default function HelpCenterPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Help Center", href: "/help" },
        ]}
      />

      <PageHero
        eyebrow="Help Center"
        headline="How can we"
        scriptAccent="help?"
        sub="Find fast answers about shipping, satisfaction guarantee, ingredients, and ordering. If you need a human, we reply within one business day."
        ctas={[
          { href: "/contact", label: "Email support", variant: "primary" },
          { href: "/shop", label: "Shop now", variant: "light" },
        ]}
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Quick Links ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Start
              <br />
              <span className="lp-script text-[var(--lp-red)]">here.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORT_LINKS.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className="group block border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 no-underline"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)] group-hover:text-[var(--lp-red)]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {item.copy}
                </p>
                <p className="lp-label mt-4 text-[var(--lp-red)]">View details →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-2 text-[var(--lp-red)]">★ Still Need Help? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            We&rsquo;re
            <br />
            <span className="lp-script text-[var(--lp-red)]">here.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
            Use the chat bubble or send a message on the contact page. We typically respond within one
            business day.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/contact" className="lp-cta">
              Contact us
            </Link>
            <Link href="/shop" className="lp-cta lp-cta-light">
              Shop USA Gummies
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
