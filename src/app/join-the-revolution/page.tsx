import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export const metadata: Metadata = {
  title: "Join the Revolution | USA Gummies",
  description:
    "Join the Revolution by purchasing USA Gummies. Unlock member eligibility, savings benefits, and subscription access after your first order.",
};

const STEPS = [
  {
    title: "1. Buy USA Gummies",
    body: `Choose 5, 8, or 12 bags. ${FREE_SHIPPING_PHRASE}.`,
  },
  {
    title: "2. Join the Revolution",
    body:
      "Your first order unlocks membership status and subscription eligibility for USA Gummies.",
  },
  {
    title: "3. Member access",
    body:
      "Watch for your access email. We will send your sign-in link once the portal is live.",
  },
];

const BENEFITS = [
  {
    title: "Bag-count savings",
    body:
      "Lower per-bag pricing as you add more bags, with the best balance of value + convenience at 8 bags.",
  },
  {
    title: "Subscription eligibility",
    body:
      "Subscriptions unlock after your first purchase. We will email your access link once you qualify.",
  },
  {
    title: "Early drops",
    body:
      "Priority access to new runs, limited drops, and premium restocks before they sell out.",
  },
  {
    title: "American-made confidence",
    body:
      "Made in the USA with all natural flavors and no artificial dyes or synthetic colors.",
  },
];

export default function JoinTheRevolutionPage() {
  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(255,77,79,0.14), transparent 48%), radial-gradient(circle at 85% 5%, rgba(255,199,44,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Join the Revolution", href: "/join-the-revolution" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  Loyalty access
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  Join the Revolution
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  Purchasing these gummies is a vote in the America you believe in. The American Dream
                  is something to always strive for and try to achieve. Join the Revolution by choosing
                  USA Gummies and unlock member benefits after your first order.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop now
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <Image
                      src="/brand/usa-gummies-family.webp"
                      alt="USA Gummies All American gummy bears"
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-contain"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      All American gummy bears
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      All natural flavors, no artificial dyes or synthetic colors.
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">Classic gummy bear flavor</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {step.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{step.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Member benefits
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Benefits that make joining worth it.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                USA Gummies members get priority access and premium perks that reward loyal buyers of
                our All American gummy bears.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {BENEFITS.map((benefit) => (
                  <div
                    key={benefit.title}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4"
                  >
                    <div className="text-sm font-semibold text-[var(--text)]">{benefit.title}</div>
                    <div className="mt-2 text-sm text-[var(--muted)]">{benefit.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Member portal
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Member access launches after purchase.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Place your first order and you are in. We will email your sign-in link as soon as the
                Revolution portal is live.
              </p>
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                <div className="text-xs font-semibold text-[var(--text)]">What members get</div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                  <li>Order history tied to your checkout email</li>
                  <li>Subscription eligibility after your first order</li>
                  <li>Early drops and premium savings alerts</li>
                </ul>
              </div>

              <div className="mt-5 border-t border-[var(--border)] pt-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                  How you qualify
                </div>
                <h3 className="mt-2 text-xl font-black text-[var(--text)]">
                  Membership unlocks after purchase.
                </h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Place your first order for USA Gummies and you are in. Subscriptions are reserved
                  for members who have already purchased.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop now
                  </Link>
                  <Link href="/faq" className="btn btn-outline">
                    Read the FAQ
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
