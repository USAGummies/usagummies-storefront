import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Terms of Service | USA Gummies";
const PAGE_DESCRIPTION =
  "USA Gummies terms of service. Purchase terms, site use, and secure Shopify-powered checkout details.";
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

export default function TermsPage() {
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
          <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-3 text-[var(--muted)]">
            These terms of service apply to purchases made through USA Gummies. Checkout is processed
            securely through Shopify.
          </p>

          <div className="mt-8 space-y-6 text-[var(--muted)]">
            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Orders</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                By placing an order, you agree that the information you provide is accurate and that
                you are authorized to use the selected payment method.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Pricing</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Prices are shown in your cart at checkout. Savings pricing and shipping eligibility
                (including Free shipping on 5+ bags) are displayed clearly before you purchase.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Checkout & payments</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Checkout is powered by <strong className="text-[var(--text)]">Shopify</strong>.
                Payment details are processed securely by Shopify and related providers.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Site use</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                You agree not to misuse the site, attempt unauthorized access, or disrupt site operations.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Changes</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                We may update these terms from time to time. The latest version will always be posted on this page.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-[var(--muted)]">
              Terms question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Terms of Service Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
