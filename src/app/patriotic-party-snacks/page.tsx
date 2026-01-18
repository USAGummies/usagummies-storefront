import Link from "next/link";
import type { Metadata } from "next";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";

export const metadata: Metadata = {
  title: "Patriotic Party Snacks | USA Gummies Bundles",
  description:
    "Patriotic party snacks and gummy bundles for July 4th and USA-themed events. Bundle and save with USA Gummies.",
};

const PARTY_TIPS = [
  "8 bag bundles are the most popular for backyard parties.",
  "12 bag bundles are best for large groups and team events.",
  "5+ bags unlock free shipping for party planning.",
];

const RELATED_GUIDES = [
  { href: "/gummy-gift-bundles", label: "Gummy gift bundles" },
  { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  { href: "/bundle-guides", label: "All bundle guides" },
];

export default function PatrioticPartySnacksPage() {
  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <section className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        <div className="candy-panel rounded-[36px] p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Party snacks
          </div>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)] sm:text-4xl">
            Patriotic party snacks and gummy bundles
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)] sm:text-base max-w-prose">
            Hosting a July 4th party or an America-themed event? USA Gummies bundles make easy
            shareable snacks. Build a bundle for crowd-ready gummy bears.
          </p>

          <div className="mt-6 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
            <div className="text-sm font-black text-[var(--text)]">Party sizing tips</div>
            <ul className="mt-2 grid gap-2 text-xs text-[var(--muted)]">
              {PARTY_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[var(--gold)]" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/shop#bundle-pricing" className="btn btn-candy">
              Build my bundle
            </Link>
            <Link href="/made-in-usa" className="btn btn-outline">
              Made in USA
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
