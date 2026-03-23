import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { SocialProofStat, TrustBar } from "@/components/social-proof/TrustBar";
import { SubscribeWaitlist } from "./SubscribeWaitlist.client";

const PAGE_TITLE = "Subscribe & Save — Coming Soon | USA Gummies";
const PAGE_DESCRIPTION =
  "Subscribe to USA Gummies and save on every delivery. Sign up for our waitlist to get early access when Subscribe & Save launches.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "https://www.usagummies.com/subscribe" },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "https://www.usagummies.com/subscribe",
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function SubscribePage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen home-candy">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Subscribe & Save", href: "/subscribe" },
        ]}
      />

      {/* Hero */}
      <div className="relative w-full h-[280px] sm:h-[340px] lg:h-[400px] overflow-hidden">
        <Image
          src="/brand/gallery/bag-navy-hero.jpg"
          alt="USA Gummies bag with patriotic styling"
          fill
          sizes="100vw"
          className="object-cover object-center"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/40 via-[#1B2A4A]/60 to-[#1B2A4A]/85" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <div className="relative w-44 h-20 mb-3">
            <Image
              src="/brand/logo-full.png"
              alt="USA Gummies"
              fill
              sizes="176px"
              className="object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]"
            />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="rounded-full border border-[#C9A44A]/40 bg-[#C9A44A]/20 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#C9A44A]">
              Coming Soon
            </span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            Subscribe &amp; Save
          </h1>
          <p className="mt-2 text-base sm:text-lg text-white/90 max-w-lg drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
            We&rsquo;re building a subscription option so you never run out. Join the waitlist for early access.
          </p>
          <div className="mt-4">
            <SocialProofStat />
          </div>
        </div>
      </div>

      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-4xl px-4 py-8">
          {/* Main panel */}
          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            {/* What to expect */}
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              What to expect
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Here&rsquo;s what we&rsquo;re building.
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                { icon: "📦", title: "Auto-delivery", desc: "Choose your quantity and frequency — we ship on schedule." },
                { icon: "💰", title: "Subscriber savings", desc: "Exclusive pricing below our bundle deals." },
                { icon: "🔄", title: "Flexible", desc: "Pause, skip, or cancel anytime. No commitments." },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-center">
                  <div className="text-2xl">{item.icon}</div>
                  <div className="mt-2 text-sm font-semibold text-[var(--text)]">{item.title}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{item.desc}</div>
                </div>
              ))}
            </div>

            {/* Waitlist form */}
            <div className="mt-8">
              <SubscribeWaitlist />
            </div>

            {/* Trust */}
            <div className="mt-6">
              <TrustBar variant="full" />
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  Don&rsquo;t want to wait?
                </div>
                <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                  Shop our bundle deals now.
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Save per bag with bundles. Free shipping on 5+ bags.
                </p>
              </div>
              <Link href="/shop" className="btn btn-candy">
                Shop bundles
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
