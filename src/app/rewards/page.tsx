import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { RewardsView } from "./RewardsView.client";

export const metadata: Metadata = {
  title: "Rewards Program — Earn Free Gummy Bears | USA Gummies",
  description:
    "Earn points with every purchase. Redeem for free bags of all-natural, made-in-USA gummy bears. 1 point per $1 spent. No artificial dyes.",
  alternates: {
    canonical: "https://www.usagummies.com/rewards",
  },
  openGraph: {
    title: "Rewards Program — Earn Free Gummy Bears | USA Gummies",
    description:
      "Earn points with every purchase. Redeem for free bags of all-natural, made-in-USA gummy bears.",
    url: "https://www.usagummies.com/rewards",
  },
};

const FAQS = [
  {
    question: "How do I earn points?",
    answer:
      "You earn 1 point for every $1 you spend on USA Gummies. Points are automatically added to your account after each order.",
  },
  {
    question: "What can I redeem points for?",
    answer:
      "100 points gets you 1 free bag of gummy bears. 250 points gets you a 3-pack. We'll add the free bags to your next order.",
  },
  {
    question: "How does the referral program work?",
    answer:
      "Share your unique referral code with friends. When they place their first order, you earn 50 bonus points.",
  },
  {
    question: "Do my points expire?",
    answer:
      "No, your points never expire as long as your account is active.",
  },
  {
    question: "Can I earn points on subscription orders?",
    answer:
      "Yes! You earn points on every subscription delivery, just like regular orders.",
  },
  {
    question: "How do I check my balance?",
    answer:
      "Enter your email on this page to see your points balance, available rewards, and transaction history.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
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
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C9A44A]">
            USA Gummies Rewards
          </div>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl lg:text-5xl">
            Earn free gummy bears.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-white/70 sm:text-base">
            Every dollar you spend earns you points toward free bags of our all-natural,
            made-in-USA gummy bears. No catches, no expiration.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              How it works
            </div>
            <h2 className="mt-2 text-xl font-black text-[var(--text)] sm:text-2xl">
              Three simple steps
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Shop & earn",
                desc: "Earn 1 point for every $1 you spend. Points are added automatically after each order.",
              },
              {
                step: "2",
                title: "Reach a reward",
                desc: "100 points = 1 free bag. 250 points = a free 3-pack. Track your progress below.",
              },
              {
                step: "3",
                title: "Redeem & enjoy",
                desc: "Hit redeem and we'll add free bags to your next order. It's that simple.",
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

          {/* Redemption tiers */}
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

      {/* Account lookup + management */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
          <RewardsView />
        </div>
      </section>

      {/* Referral section */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Refer a friend
          </div>
          <h2 className="mt-2 text-xl font-black text-[var(--text)] sm:text-2xl">
            Share the love, earn 50 bonus points.
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--muted)]">
            When a friend makes their first order using your referral code, you earn 50 bonus points.
            Look up your account above to find your unique referral code.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
          <div className="text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              FAQ
            </div>
            <h2 className="mt-2 text-xl font-black text-[var(--text)] sm:text-2xl">
              Common questions
            </h2>
          </div>
          <div className="mt-6 space-y-4">
            {FAQS.map((faq) => (
              <div
                key={faq.question}
                className="rounded-2xl border border-[var(--border)] bg-white p-4"
              >
                <div className="text-sm font-bold text-[var(--text)]">{faq.question}</div>
                <div className="mt-1 text-sm text-[var(--muted)]">{faq.answer}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 text-center sm:py-10">
          <h2 className="text-xl font-black text-[var(--text)] sm:text-2xl">
            Ready to start earning?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Every order earns you points. Shop now and start building toward your first free bag.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/shop"
              className="btn btn-candy pressable px-6 py-2.5 text-sm font-bold"
            >
              Shop now
            </Link>
            <Link
              href="/subscribe"
              className="rounded-full border-2 border-[#2D7A3A] px-6 py-2.5 text-sm font-bold text-[#2D7A3A] transition hover:bg-[#2D7A3A]/5"
            >
              Subscribe &amp; save
            </Link>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
