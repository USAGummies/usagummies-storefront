import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Welcome",
  description:
    "Thanks for choosing USA Gummies! Leave a review, reorder your favorites, or share with friends.",
  robots: { index: false, follow: true },
};

const REVIEW_URL = "https://www.amazon.com/review/create-review?asin=B0G1JK92TJ";

const ACTIONS = [
  {
    icon: "⭐",
    title: "Leave a review",
    description: "Loved them? A quick review helps other families find dye-free gummies.",
    href: REVIEW_URL,
    cta: "Write a review",
    external: true,
    primary: true,
  },
  {
    icon: "🔄",
    title: "Reorder & save",
    description: "Stock up with bundle pricing. Free shipping on every order.",
    href: "/shop",
    cta: "Shop bundles",
    external: false,
    primary: false,
  },
  {
    icon: "🎁",
    title: "Share with a friend",
    description: "Know someone who'd love dye-free gummies? Send them our way.",
    href: "/gummy-gift-bundles",
    cta: "Gift options",
    external: false,
    primary: false,
  },
];

const QUICK_LINKS = [
  { label: "FAQ", href: "/faq" },
  { label: "Ingredients", href: "/ingredients" },
  { label: "Our story", href: "/about" },
  { label: "Contact us", href: "/contact" },
];

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-[var(--surface-strong)] text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Welcome", href: "/welcome" },
        ]}
      />

      {/* ── HERO ── */}
      <section className="relative flex min-h-[280px] items-center justify-center overflow-hidden bg-[#1B2A4A] sm:min-h-[340px]">
        <Image
          src="/brand/americana/crossing-freedom.jpg"
          alt="USA Gummies brand background"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/50 to-[#1B2A4A]/80" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-4 text-center">
          <Image
            src="/brand/logo-full.png"
            alt="USA Gummies logo"
            width={200}
            height={128}
            className="h-auto w-[140px] sm:w-[180px]"
          />
          <h1 className="font-display text-3xl font-black text-white sm:text-4xl lg:text-5xl">
            Thanks for choosing USA Gummies!
          </h1>
          <p className="max-w-md text-sm text-white/80 sm:text-base">
            You just supported American-made, dye-free candy.
            Here&rsquo;s how to get the most out of your bag.
          </p>
        </div>
      </section>

      {/* ── ACTIONS ── */}
      <section className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <div className="space-y-4">
          {ACTIONS.map((action) => (
            <div
              key={action.title}
              className={`rounded-2xl border p-5 sm:p-6 transition ${
                action.primary
                  ? "border-[rgba(199,54,44,0.3)] bg-white shadow-md"
                  : "border-[rgba(15,27,45,0.1)] bg-white"
              }`}
            >
              <div className="flex items-start gap-4">
                <span className="text-3xl" aria-hidden="true">
                  {action.icon}
                </span>
                <div className="flex-1 space-y-2">
                  <h2 className="text-lg font-black text-[var(--text)]">
                    {action.title}
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    {action.description}
                  </p>
                  {action.external ? (
                    <a
                      href={action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-block rounded-full px-6 py-2.5 text-sm font-bold transition ${
                        action.primary
                          ? "bg-[#c7362c] text-white hover:bg-[#a82920]"
                          : "border-2 border-[#1B2A4A] text-[#1B2A4A] hover:bg-[#f0ede6]"
                      }`}
                    >
                      {action.cta}
                    </a>
                  ) : (
                    <Link
                      href={action.href}
                      className={`inline-block rounded-full px-6 py-2.5 text-sm font-bold transition ${
                        action.primary
                          ? "bg-[#c7362c] text-white hover:bg-[#a82920]"
                          : "border-2 border-[#1B2A4A] text-[#1B2A4A] hover:bg-[#f0ede6]"
                      }`}
                    >
                      {action.cta}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── QUICK LINKS ── */}
        <div className="mt-10 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Quick links
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full border border-[rgba(15,27,45,0.1)] bg-white px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-strong)]"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
