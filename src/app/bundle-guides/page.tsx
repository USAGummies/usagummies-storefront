import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "USA Gummies Bundle Guides | Gift, Party, and Bulk Bundles",
  description:
    "Explore USA Gummies bundle guides for gifts, parties, and bulk orders. Find the right bundle size and build your bundle.",
};

const GUIDES = [
  {
    href: "/gummy-gift-bundles",
    title: "Gummy gift bundles",
    description: "Gift-ready bundles for birthdays, thank yous, and care packages.",
  },
  {
    href: "/patriotic-party-snacks",
    title: "Patriotic party snacks",
    description: "Bundle picks for July 4th and USA-themed events.",
  },
  {
    href: "/bulk-gummy-bears",
    title: "Bulk gummy bears",
    description: "Crowd-ready bundles for teams, clients, and events.",
  },
];

export default function BundleGuidesPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bundle guides", href: "/bundle-guides" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Bundle guides
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Find the right USA Gummies bundle
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Use these guides to match bundle size to the moment. Build a gift bundle, plan party
            snacks, or order bulk gummy bears for teams and events.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {GUIDES.map((guide) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4 hover:border-[rgba(15,27,45,0.22)] hover:shadow-[0_14px_30px_rgba(15,27,45,0.12)]"
              >
                <div className="text-sm font-black text-[var(--text)]">{guide.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{guide.description}</div>
                <div className="mt-3 text-xs font-semibold text-[var(--navy)]">
                  View guide {"->"}
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Build my bundle
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bundle FAQ
            </Link>
          </div>

          <div className="mt-4 text-xs text-[var(--muted)]">
            Made in the USA. No artificial dyes. Free shipping on 5+ bags.
          </div>
        </div>

        <AmericanDreamCallout variant="compact" tone="light" className="mt-6" showJoinButton={false} />
      </section>
    </main>
  );
}
