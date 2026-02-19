import Link from "next/link";
import Image from "next/image";
import { GummyIconRow } from "@/components/ui/GummyIcon";

const POPULAR_PAGES = [
  { label: "Shop Gummy Bears", href: "/shop", emoji: "🛒" },
  { label: "Bundle Deals", href: "/shop", emoji: "📦" },
  { label: "Our Ingredients", href: "/ingredients", emoji: "🌿" },
  { label: "Made in the USA", href: "/made-in-usa", emoji: "🇺🇸" },
  { label: "About Us", href: "/about", emoji: "📖" },
  { label: "Contact Support", href: "/contact", emoji: "💬" },
];

export default function NotFound() {
  return (
    <main className="relative min-h-[70vh] overflow-hidden">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24 text-center">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="relative w-28 h-14">
            <Image
              src="/brand/logo-full.png"
              alt="USA Gummies"
              fill
              sizes="112px"
              className="object-contain"
            />
          </div>
        </div>

        {/* Gummy row divider */}
        <div className="flex justify-center mb-6">
          <GummyIconRow size={24} />
        </div>

        {/* 404 message */}
        <h1 className="font-display text-5xl sm:text-6xl font-bold text-[var(--navy,#1B2A4A)] tracking-tight">
          404
        </h1>
        <p className="mt-3 text-lg font-semibold text-[var(--text,#1B2A4A)]">
          This page got lost on the way to your mouth.
        </p>
        <p className="mt-2 text-sm text-[var(--muted,#5f5b56)] max-w-md mx-auto">
          We couldn&rsquo;t find the page you&rsquo;re looking for. But our gummy bears are
          easy to find&mdash;try one of the links below.
        </p>

        {/* Primary CTAs */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/shop" className="btn btn-candy pressable">
            Shop Gummy Bears
          </Link>
          <Link href="/" className="btn btn-outline pressable">
            Back to Home
          </Link>
        </div>

        {/* Popular pages grid */}
        <div className="mt-10">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted,#5f5b56)] mb-4">
            Popular pages
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {POPULAR_PAGES.map((page) => (
              <Link
                key={page.href + page.label}
                href={page.href}
                className="group rounded-2xl border border-[var(--border,rgba(15,27,45,0.1))] bg-white p-3 text-center transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(15,27,45,0.1)]"
              >
                <div className="text-xl mb-1">{page.emoji}</div>
                <div className="text-xs font-semibold text-[var(--text,#1B2A4A)] group-hover:text-[var(--navy,#1B2A4A)]">
                  {page.label}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Trust line */}
        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-[var(--muted,#5f5b56)]">
          <Image
            src="/brand/logo.png"
            alt="USA Gummies logo"
            width={48}
            height={18}
            className="h-auto w-10 object-contain"
          />
          <span>Made in the USA &bull; No artificial dyes &bull; Ships in 24h</span>
        </div>
      </div>
    </main>
  );
}
