import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Gummy Gift Bundles | USA Gummies",
  description:
    "Gift-ready gummy bundles made in the USA. Use 4, 5, 8, or 12 bag bundles for birthdays, thank you gifts, and care packages.",
};

const BUNDLE_IDEAS = [
  {
    title: "Starter gift",
    detail: "4 bag bundle for small thank you gifts and care packages.",
  },
  {
    title: "Free shipping pick",
    detail: "5 bag bundle to unlock free shipping and easy gifting.",
  },
  {
    title: "Most popular gift",
    detail: "8 bag bundle for office gifting, family packs, and parties.",
  },
  {
    title: "Bulk gifting",
    detail: "12 bag bundle for teams, clients, and large events.",
  },
];

const RELATED_GUIDES = [
  { href: "/patriotic-party-snacks", label: "Patriotic party snacks" },
  { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  { href: "/bundle-guides", label: "All bundle guides" },
];

export default function GummyGiftBundlesPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "Bundle guides", href: "/bundle-guides" },
            { name: "Gummy gift bundles", href: "/gummy-gift-bundles" },
          ]}
        />
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Gift bundles
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Gummy gift bundles made in the USA
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            USA Gummies bundles make easy gifts for birthdays, thank yous, and care packages. Pick
            the bundle size that matches your list and ship fast.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {BUNDLE_IDEAS.map((idea) => (
              <div
                key={idea.title}
                className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4"
              >
                <div className="text-sm font-black text-[var(--text)]">{idea.title}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">{idea.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Build my bundle
            </Link>
            <Link href="/ingredients" className="btn btn-outline">
              Ingredients
            </Link>
            <Link href="/faq" className="btn btn-outline">
              Bundle FAQ
            </Link>
          </div>

          <div className="mt-4 text-xs text-[var(--muted)]">
            Free shipping at 5+ bags. Bundles save more per bag.
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
