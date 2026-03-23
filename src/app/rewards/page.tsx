import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { RewardsWaitlist } from "./RewardsWaitlist.client";

export const metadata: Metadata = {
  title: "Rewards Program — Coming Soon | USA Gummies",
  description:
    "We're building a rewards program where every purchase earns points toward free gummy bears. Join the waitlist for early access.",
  alternates: {
    canonical: "https://www.usagummies.com/rewards",
  },
  openGraph: {
    title: "Rewards Program — Coming Soon | USA Gummies",
    description:
      "We're building a rewards program where every purchase earns points toward free gummy bears. Join the waitlist.",
    url: "https://www.usagummies.com/rewards",
  },
};

export default function RewardsPage() {
  return (
    <main className="min-h-screen bg-[var(--surface)] text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Rewards", href: "/rewards" },
        ]}
      />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#1B2A4A] to-[#0F1B2D] text-white">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:py-16">
          <span className="inline-block rounded-full border border-[#C9A44A]/40 bg-[#C9A44A]/20 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#C9A44A]">
            Coming Soon
          </span>
          <h1 className="mt-4 text-3xl font-black sm:text-4xl lg:text-5xl">
            Earn free gummy bears.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-white/70 sm:text-base">
            We&rsquo;re building a rewards program where every dollar you spend earns points
            toward free bags. Join the waitlist for early access.
          </p>
        </div>
      </section>

      {/* What we're building */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              What we&rsquo;re building
            </div>
            <h2 className="mt-2 text-xl font-black text-[var(--text)] sm:text-2xl">
              How it will work
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Shop & earn",
                desc: "Earn 1 point for every $1 you spend. Points added automatically.",
              },
              {
                step: "2",
                title: "Reach a reward",
                desc: "100 points = 1 free bag. 250 points = a free 3-pack.",
              },
              {
                step: "3",
                title: "Redeem & enjoy",
                desc: "Free bags added to your next order. Simple as that.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-center"
              >
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#C9A44A] text-lg font-black text-white">
                  {item.step}
                </div>
                <div className="mt-3 text-sm font-black text-[var(--text)]">{item.title}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">{item.desc}</div>
              </div>
            ))}
          </div>

          {/* Planned reward tiers */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border-2 border-[#C9A44A]/30 bg-[#C9A44A]/5 p-4 text-center">
              <div className="text-3xl font-black text-[#C9A44A]">100</div>
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
                points
              </div>
              <div className="mt-2 text-sm font-black text-[var(--text)]">1 Free Bag</div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                One bag of classic gummy bears added to your next order
              </div>
            </div>
            <div className="rounded-2xl border-2 border-[#C9A44A]/30 bg-[#C9A44A]/5 p-4 text-center">
              <div className="text-3xl font-black text-[#C9A44A]">250</div>
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
                points
              </div>
              <div className="mt-2 text-sm font-black text-[var(--text)]">Free 3-Pack</div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                Three bags added to your next order — best value
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
          <RewardsWaitlist />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 text-center sm:py-10">
          <h2 className="text-xl font-black text-[var(--text)] sm:text-2xl">
            Shop now — rewards are coming soon.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Every purchase you make today will count toward your points balance when the program launches.
          </p>
          <div className="mt-4">
            <Link
              href="/shop"
              className="btn btn-candy pressable px-6 py-2.5 text-sm font-bold"
            >
              Shop now
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
