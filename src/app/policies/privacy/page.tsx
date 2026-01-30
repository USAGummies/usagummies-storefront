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
const PAGE_TITLE = "Privacy Policy | USA Gummies";
const PAGE_DESCRIPTION =
  "USA Gummies privacy policy. What information we collect, how it’s used, and how Shopify checkout protects payment details.";
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

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: "Privacy", href: "/policies/privacy" },
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
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-3 text-[var(--muted)]">
            This privacy policy keeps things simple: we only use information needed to process your
            order and improve your experience. Payments are handled securely through Shopify checkout.
          </p>

          <div className="mt-8 divide-y divide-[var(--border)] text-[var(--muted)]">
            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">What we collect</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                When you place an order, we collect information required to fulfill it, such as
                your name, shipping address, email, and order details.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">How we use it</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                We use your information to process orders, provide updates, respond to support requests,
                and improve the site experience.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Payments</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Payment information is processed securely through{" "}
                <strong className="text-[var(--text)]">Shopify checkout</strong>.
                We do not store your full payment card details on our servers.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Cookies</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                We may use cookies and similar technologies to support site functionality
                and understand how visitors use the site.
              </p>
            </div>

            <div className="py-4">
              <h2 className="text-lg font-semibold text-[var(--text)]">Contact</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If you have privacy questions, contact us using the form below.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-[var(--muted)]">
              Privacy question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Privacy Policy Question" />
            </div>
          </div>
          <div className="mt-6 text-sm text-[var(--muted)]">
            Explore the shop:{" "}
            <Link href="/shop" className="underline underline-offset-4 text-[var(--text)]">
              all-natural American gummy bears
            </Link>
            .
          </div>
        </section>
      </div>
    </main>
  );
}
