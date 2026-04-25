// Minimal footer — main brand logo, three link columns, navy legal bar.

import Image from "next/image";
import Link from "next/link";

export function FooterMini() {
  return (
    <footer className="relative border-t-4 border-[var(--lp-red)] bg-[var(--lp-cream)]">
      <div className="lp-bunting" aria-hidden />
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-5 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-8">
        <div>
          {/* Main USA Gummies brand logo (USA wing crest + GUMMIES
              wordmark + "Made in the U.S.A." script). Replaces the
              typed wordmark per Ben's audit ("on the bottom of the
              page, this should be the main logo"). */}
          <Link href="/" aria-label="USA Gummies — home" className="block">
            <Image
              src="/brand/logo.png"
              alt="USA Gummies — Made in the U.S.A."
              width={1118}
              height={645}
              sizes="(max-width: 640px) 200px, 260px"
              className="h-auto w-[200px] sm:w-[260px]"
            />
          </Link>
          <p className="lp-sans mt-5 max-w-[32ch] text-[1rem] font-normal text-[var(--lp-ink)]/80">
            All-natural gummy bears. Sourced, made, and packed in the U.S.A.
          </p>
          <p className="lp-label mt-3 text-[var(--lp-red)]">
            ★ 100% Made in the USA · Freedom from Artificial Dyes
          </p>
        </div>
        <nav aria-label="Shop" className="space-y-2">
          <p className="lp-label mb-2 text-[var(--lp-red)]">Shop</p>
          <Link href="/shop" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            All products
          </Link>
          <Link href="/wholesale" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            Wholesale
          </Link>
          <Link href="/bulk-gummy-bears" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            Bulk orders
          </Link>
        </nav>
        <nav aria-label="Company" className="space-y-2">
          <p className="lp-label mb-2 text-[var(--lp-red)]">Company</p>
          <Link href="/about" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            About
          </Link>
          <Link href="/ingredients" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            Ingredients
          </Link>
          <Link href="/contact" className="lp-sans block text-[1rem] font-medium text-[var(--lp-ink)] hover:text-[var(--lp-red)]">
            Contact
          </Link>
        </nav>
      </div>
      {/* Solid navy + gold hairline mirrors the hero header — keeps
          the patriotic palette without the dotted starfield bleeding
          through the small-cap legal copy. */}
      <div
        style={{
          backgroundColor: "var(--lp-navy)",
          color: "var(--lp-off-white)",
          borderTop: "2px solid var(--lp-gold)",
        }}
      >
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-2 px-5 py-4 sm:flex-row sm:px-8">
          <span className="lp-label text-[var(--lp-off-white)]/80">
            © USA Gummies · Made in the U.S.A. · Est. 2025
          </span>
          <span className="lp-label flex gap-4 text-[var(--lp-off-white)]/80">
            <Link href="/policies/terms" className="hover:text-[var(--lp-gold)]">Terms</Link>
            <Link href="/policies/privacy" className="hover:text-[var(--lp-gold)]">Privacy</Link>
            <Link href="/policies/returns" className="hover:text-[var(--lp-gold)]">Returns</Link>
          </span>
        </div>
      </div>
      <div className="pb-24 md:pb-0" aria-hidden />
    </footer>
  );
}
