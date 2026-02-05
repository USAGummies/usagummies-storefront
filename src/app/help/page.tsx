import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

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
  "Get quick answers on shipping, satisfaction guarantee, ingredients, and ordering USA Gummies. Contact support in one click.";
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
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Help Center", href: "/help" },
        ]}
      />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Home
          </Link>
          <Link
            href="/contact"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Contact support
          </Link>
        </div>

        <section className="candy-panel p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Help Center
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                How can we help?
              </h1>
              <p className="mt-3 text-[var(--muted)]">
                Find fast answers about shipping, satisfaction guarantee, ingredients, and ordering. If you need
                a human, contact support and we will reply within one business day.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/shop" className="btn btn-candy">
                Shop USA Gummies
              </Link>
              <Link href="/contact" className="btn btn-outline">
                Email support
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {SUPPORT_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 text-sm text-[var(--text)] transition hover:border-[rgba(15,27,45,0.2)] hover:bg-white"
              >
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-2 text-sm text-[var(--muted)]">{item.copy}</div>
                <div className="mt-3 text-xs font-semibold text-[var(--navy)]">
                  View details {"->"}
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-5 text-sm text-[var(--muted)]">
            <div className="text-sm font-semibold text-[var(--text)]">Still need help?</div>
            <div className="mt-2">
              Use the chat bubble or send a message on the{" "}
              <Link href="/contact" className="underline underline-offset-4 text-[var(--text)]">
                contact page
              </Link>
              . We typically respond within one business day.
            </div>
          </div>

          <div className="mt-6 text-sm text-[var(--muted)]">
            Looking for American-made gummy bears?{" "}
            <Link href="/shop" className="underline underline-offset-4 text-[var(--text)]">
              Shop all-natural USA Gummies
            </Link>
            .
          </div>
        </section>
      </div>
    </main>
  );
}
