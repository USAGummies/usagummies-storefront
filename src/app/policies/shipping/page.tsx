import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Shipping Policy | USA Gummies";
const PAGE_DESCRIPTION =
  "USA Gummies shipping policy including processing times, delivery expectations, and tracking. Free shipping on 5+ bags.";
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

export default function ShippingPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-12">
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
            Shop now
          </Link>
        </div>

        <section className="candy-panel p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Shipping Policy</h1>
          <p className="mt-3 text-[var(--muted)]">
            This shipping policy keeps delivery simple and predictable. Orders ship within 24 hours,
            with tracking sent fast. Savings pricing is clear on every product page, plus shipping
            updates. Free shipping on 5+ bags.
          </p>

          <div className="mt-8 space-y-6 text-[var(--muted)]">
            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Free shipping</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Free shipping on 5+ bags.
                The product page and cart will reflect this automatically.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Processing time</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Orders ship within <strong className="text-[var(--text)]">24 hours</strong>.
                If an order is placed after the daily carrier pickup time or on weekends/holidays,
                it ships the next business day. We prep and label orders within 24 hours.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Delivery time</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Delivery speed depends on the carrier and destination. Most customers receive orders
                within <strong className="text-[var(--text)]">2–7 business days</strong> after shipment.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Tracking</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Tracking details are sent within 24 hours of your order.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Shipping issues</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If your package is delayed, missing, or arrives damaged, contact us using the form below.
                We’ll make it right.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-[var(--muted)]">
              Shipping question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Shipping Policy Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
