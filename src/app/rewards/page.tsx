import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";
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

const STEPS = [
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
];

const TIERS = [
  {
    points: "100",
    title: "1 Free Bag",
    desc: "One bag of classic gummy bears added to your next order",
  },
  {
    points: "250",
    title: "Free 3-Pack",
    desc: "Three bags added to your next order — best value",
  },
];

export default function RewardsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Rewards", href: "/rewards" },
        ]}
      />

      <PageHero
        eyebrow="Coming Soon"
        headline="Earn free"
        scriptAccent="gummy bears."
        sub="We're building a rewards program where every dollar you spend earns points toward free bags. Join the waitlist for early access."
        ctas={[{ href: "#waitlist", label: "Join the waitlist" }]}
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ How It Works ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Three simple
              <br />
              <span className="lp-script text-[var(--lp-red)]">steps.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {STEPS.map((item, i) => (
              <div
                key={item.step}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 text-center"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <div className="lp-display text-[2.4rem] leading-none text-[var(--lp-red)]">
                  {item.step}
                </div>
                <h3 className="lp-display mt-4 text-[1.3rem] leading-tight text-[var(--lp-ink)]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1000px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Reward Tiers ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Free bags
              <br />
              <span className="lp-script text-[var(--lp-red)]">await.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {TIERS.map((tier, i) => (
              <div
                key={tier.points}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 text-center"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <div className="lp-display text-[3.5rem] leading-none text-[var(--lp-red)]">
                  {tier.points}
                </div>
                <p className="lp-label mt-2 text-[var(--lp-ink)]/65">points</p>
                <h3 className="lp-display mt-4 text-[1.4rem] leading-tight text-[var(--lp-ink)]">
                  {tier.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {tier.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="waitlist" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[640px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Early Access ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Join the
              <br />
              <span className="lp-script text-[var(--lp-red)]">waitlist.</span>
            </h2>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <RewardsWaitlist />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Shop Now ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Every purchase
            <br />
            <span className="lp-script text-[var(--lp-red)]">counts.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
            Every purchase you make today will count toward your points balance when the program launches.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop now
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
