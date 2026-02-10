// src/app/thank-you/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";
import { SubscriptionUnlock } from "@/components/marketing/SubscriptionUnlock.client";

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
const PAGE_TITLE = "Thank You | USA Gummies";
const PAGE_DESCRIPTION = "Thanks for your USA Gummies order. You are officially part of the movement.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: { index: false, follow: false },
  alternates: { canonical: `${SITE_URL}/thank-you` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/thank-you`,
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

export default function ThankYouPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy pb-16">
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
