import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";
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
const PAGE_TITLE = "Contact USA Gummies | Customer Support & Inquiries";
const PAGE_DESCRIPTION =
  "Contact USA Gummies for customer support or business inquiries. We respond within one business day.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/contact` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/contact`,
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

export default function ContactPage() {
  return (
    <main className="min-h-screen home-hero-theme text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Contact", href: "/contact" },
        ]}
      />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Home
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Shop USA Gummies
          </Link>
        </div>

        <section className="candy-panel p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
          <p className="mt-3 text-[var(--muted)]">
            Customer support or business inquiries — send a message below.
            We respond within one business day.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "Fast response",
                copy: "We reply within one business day on weekdays.",
              },
              {
                title: "Order help",
                copy: "Include your order number for faster support.",
              },
              {
                title: "Shipping & satisfaction guarantee",
                copy: "See our policies for timing and how we make it right.",
                link: "/policies",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--muted)]"
              >
                <div className="text-sm font-semibold text-[var(--text)]">{item.title}</div>
                <div className="mt-2">
                  {item.copy}{" "}
                  {item.link ? (
                    <Link href={item.link} className="underline underline-offset-4">
                      View policies
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
            <div className="font-semibold text-[var(--text)]">What can we help with?</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
              <li>Order questions</li>
              <li>Shipping & delivery</li>
              <li>Damaged or incorrect items</li>
              <li>Wholesale / partnerships</li>
            </ul>
          </div>

          <div className="mt-6">
            <ContactForm context="Contact Page" />
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
