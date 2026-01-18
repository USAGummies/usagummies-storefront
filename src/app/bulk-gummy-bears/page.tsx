import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Bulk Gummy Bears | USA Gummies Bundles",
  description:
    "Bulk gummy bears for events, teams, and gifting. Bundle USA Gummies for fast shipping and better per bag value.",
};

const BULK_BENEFITS = [
  {
    title: "Event ready",
    detail: "12 bag bundles work well for large teams and company events.",
  },
  {
    title: "Popular value",
    detail: "8 bag bundles balance value and convenience for bulk gifting.",
  },
  {
    title: "Free shipping",
    detail: "5+ bags unlock free shipping for bulk orders.",
  },
];

const RELATED_GUIDES = [
  { href: "/gummy-gift-bundles", label: "Gummy gift bundles" },
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/bundle-guides", label: "All bundle guides" },
];

export default function BulkGummyBearsPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bundle guides", href: "/bundle-guides" },
            { name: "Bulk gummy bears", href: "/bulk-gummy-bears" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Bulk bundles
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Bulk gummy bears for events and gifting
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Stock up with USA Gummies bundles for teams, clients, and large gatherings. Bundle and
            save with fast shipping and made in the USA quality.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {BULK_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4"
              >
                <div className="text-sm font-black text-[var(--text)]">{benefit.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{benefit.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Build my bundle
            </Link>
            <Link href="/contact" className="btn btn-outline">
              Contact for large orders
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bundle FAQ
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {RELATED_GUIDES.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 text-sm font-semibold text-[var(--text)] hover:border-[rgba(15,27,45,0.22)]"
            >
              {guide.label} {"->"}
            </Link>
          ))}
        </div>

        <AmericanDreamCallout variant="compact" tone="light" className="mt-6" showJoinButton={false} />
      </section>
    </main>
  );
}
