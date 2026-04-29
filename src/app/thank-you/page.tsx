// /thank-you — post-purchase confirmation page in LP design language.
// PurchaseTracker fires the analytics + ad-platform conversion events
// regardless of which sub-section the visitor scrolls to.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { PageHero } from "@/components/lp/PageHero";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";
import PurchaseTracker from "@/components/tracking/PurchaseTracker.client";

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
const PAGE_TITLE = "Thank You";
const PAGE_DESCRIPTION =
  "Thanks for your USA Gummies order. You are officially part of the movement.";
const OG_IMAGE = "/opengraph-image";

const igImages = ["/home-patriotic-product.jpg", "/brand/hero.jpg", "/hero.jpg"];
const IG_IMAGE_ALTS: Record<string, string> = {
  "/home-patriotic-product.jpg": "USA Gummies bag on a patriotic backdrop",
  "/brand/hero.jpg": "USA Gummies gummy bear bag hero photo",
  "/hero.jpg": "USA Gummies gummy bear bag close-up",
};

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

const SHADOW_INK = { boxShadow: "5px 5px 0 var(--lp-ink)" };
const SHADOW_RED = { boxShadow: "5px 5px 0 var(--lp-red)" };

export default function ThankYouPage() {
  return (
    <main>
      <PurchaseTracker />

      <PageHero
        eyebrow="Thank You"
        headline="You're officially"
        scriptAccent="part of the movement."
        sub="Made in USA · All Natural Flavors · No Artificial Dyes — your bag of USA Gummies is on its way."
      />

      {/* Two-card grid: America 250 perks + Instagram follow */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid gap-6 md:grid-cols-2">
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={SHADOW_RED}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ America 250 Perks ★</p>
              <h2 className="lp-display text-[1.6rem] text-[var(--lp-ink)]">
                Early drops, savings,
                <br />
                <span className="lp-script text-[var(--lp-red)]">first access.</span>
              </h2>
              <ul className="lp-sans mt-4 list-disc space-y-1 pl-5 text-[1rem] text-[var(--lp-ink)]/82">
                <li>Early drops on new runs</li>
                <li>Member-only savings alerts</li>
                <li>First access to limited bags</li>
              </ul>
              <div className="mt-5">
                <Link href="/america-250" className="lp-cta">
                  Claim America 250 perks
                </Link>
              </div>
            </div>

            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={SHADOW_INK}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Follow Along ★</p>
              <h2 className="lp-display text-[1.6rem] text-[var(--lp-ink)]">
                Follow
                <br />
                <span className="lp-script text-[var(--lp-red)]">@usagummies.</span>
              </h2>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {igImages.map((src) => (
                  <div
                    key={src}
                    className="relative aspect-square overflow-hidden border-2 border-[var(--lp-ink)]"
                  >
                    <Image
                      src={src}
                      alt={IG_IMAGE_ALTS[src] || "USA Gummies Instagram photo"}
                      fill
                      sizes="(max-width: 768px) 28vw, 120px"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <Link
                  href="https://www.instagram.com/usagummies"
                  className="lp-cta lp-cta-light"
                >
                  Follow @usagummies
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Newsletter / SMS capture */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[800px] px-5 py-14 sm:px-8 sm:py-20">
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={SHADOW_RED}
          >
            <LeadCapture
              source="thank-you"
              intent="newsletter"
              title="Stay in the circle"
              subtitle="No spam. Only bold flavor news + restock alerts."
              ctaLabel="Get first access"
              variant="light"
              showSms
            />
          </div>
        </div>
      </section>

      {/* Bottom CTA — encourage next purchase */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Already Hooked? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Pick your next
            <br />
            <span className="lp-script text-[var(--lp-red)]">bag count.</span>
          </h2>
          <p className="lp-sans mx-auto mt-4 max-w-[42ch] text-[1rem] text-[var(--lp-ink)]/82">
            Free shipping on every order. Add 5 bags to drop the per-bag price from $5.99 to $5.00 — basically a free bag.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop now
            </Link>
            <Link href="/contact" className="lp-cta lp-cta-light">
              Order support
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
