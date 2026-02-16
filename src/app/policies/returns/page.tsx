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
const PAGE_TITLE = "Returns Policy | USA Gummies";
const PAGE_DESCRIPTION =
  "Learn about returns and exchanges for USA Gummies made in USA candy orders.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/policies/returns` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/policies/returns`,
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

export default function ReturnsPolicyPage() {
  return (
    <main className="min-h-screen text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: "Satisfaction guarantee", href: "/policies/returns" },
        ]}
      />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/policies"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Policies
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Shop USA Gummies
          </Link>
        </div>

        <section className="candy-panel p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Satisfaction guarantee</h1>
          <p className="mt-3 text-[var(--muted)]">
            We sell food. If something arrives wrong or damaged, we will make it right.
          </p>

          <div className="mt-8 divide-y divide-[var(--border)] text-[var(--muted)]">
            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">30-day satisfaction guarantee</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If you are not satisfied, contact us within 30 days of delivery. We will make it
                right with a replacement or account credit, subject to food-safety guidelines.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Food item policy</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Because our products are food items, we cannot take items back once delivered. If your
                order arrives damaged or incorrect, contact us and we’ll resolve it quickly.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Damaged or incorrect orders</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If your order arrives damaged or incorrect, contact us within{" "}
                <strong className="text-[var(--text)]">7 days</strong> of delivery. Include your order number and,
                if possible, a photo of the issue.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Resolution timing</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If a credit is approved, it will be issued to the original payment method. Processing
                times vary by bank and card issuer.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Order changes</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If you need to update an address or correct an order detail, contact us as soon as possible.
                Once an order ships, changes may not be possible.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-[var(--muted)]">
              Questions about the satisfaction guarantee? Send a message and we’ll respond within one
              business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Satisfaction Guarantee Question" />
            </div>
          </div>
          <div className="mt-6 text-sm text-[var(--muted)]">
            Ready to order?{" "}
            <Link href="/shop" className="underline underline-offset-4 text-[var(--text)]">
              Shop American-made gummy bears
            </Link>
            .
          </div>
        </section>
      </div>
    </main>
  );
}
