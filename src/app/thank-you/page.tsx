// src/app/thank-you/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Reveal } from "@/components/ui/Reveal";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";
import { SubscriptionUnlock } from "@/components/marketing/SubscriptionUnlock.client";

const igImages = ["/home-patriotic-product.jpg", "/brand/hero.jpg", "/hero.jpg"];

export const metadata: Metadata = {
  title: "Thank You | USA Gummies",
  description: "Thanks for your USA Gummies order. You are officially part of the movement.",
  robots: { index: false, follow: false },
};

export default function ThankYouPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen home-candy pb-16">
      <div className="mx-auto max-w-6xl px-4 pt-10">
        <Reveal className="candy-panel rounded-3xl border border-[var(--border)] p-6 space-y-3 text-[var(--text)]">
          <div className="text-xs font-semibold tracking-[0.22em] text-[var(--muted)] uppercase">
            USA Gummies
          </div>
          <h1 className="text-3xl font-black text-[var(--text)] leading-tight">
            You’re officially part of the movement.
          </h1>
          <div className="text-sm font-semibold text-[var(--muted)]">
            Made in USA • All Natural • No Artificial Dyes
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Reveal className="candy-panel rounded-2xl border border-[var(--border)] p-5 space-y-3 text-[var(--text)]">
            <div className="text-lg font-black text-[var(--text)]">America 250 perks</div>
            <ul className="list-disc list-inside text-sm text-[var(--muted)] space-y-1">
              <li>Early drops</li>
              <li>Savings deals</li>
              <li>First access to new runs</li>
            </ul>
            <Link
              href="/america-250"
              className="btn btn-candy pressable inline-flex w-fit"
            >
              Claim America 250 perks
            </Link>
          </Reveal>

          <Reveal className="candy-panel rounded-2xl border border-[var(--border)] p-5 space-y-3 text-[var(--text)]">
            <div className="text-lg font-black text-[var(--text)]">Follow @usagummies</div>
            <div className="grid grid-cols-3 gap-2">
              {igImages.map((src) => (
                <div key={src} className="relative aspect-square overflow-hidden rounded-xl border border-[var(--border)]">
                  <Image
                    src={src}
                    alt="USA Gummies social"
                    fill
                    sizes="(max-width: 768px) 28vw, 120px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
            <Link
              href="https://www.instagram.com/usagummies"
              className="btn btn-outline pressable inline-flex w-fit"
            >
              Follow @usagummies
            </Link>
          </Reveal>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Reveal>
            <LeadCapture
              source="thank-you"
              intent="newsletter"
              title="Stay in the circle"
              subtitle="No spam. Only bold flavor news."
              ctaLabel="Get first access"
              showSms
            />
          </Reveal>
          <Reveal>
            <SubscriptionUnlock source="thank-you" unlockOnMount />
          </Reveal>
        </div>

        <div className="mt-6">
          <Reveal className="candy-panel rounded-2xl border border-[var(--border)] p-5 space-y-3 text-[var(--text)]">
            <div className="text-lg font-black text-[var(--text)]">Choose your next bag count</div>
            <div className="text-sm text-[var(--muted)]">
              Free shipping on 5+ bags. Most customers go bigger on the next run.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/shop" className="btn btn-candy pressable">
                Shop now
              </Link>
              <Link href="/contact" className="btn btn-outline pressable">
                Order support
              </Link>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Ships fast. If you need help, we have you covered.
            </div>
          </Reveal>
        </div>
      </div>
    </main>
  );
}
