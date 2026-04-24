// Minimal footer — monumental wordmark, three link columns, navy legal bar.

import Link from "next/link";

export function FooterMini() {
  return (
    <footer className="relative border-t-4 border-[var(--lp-red)] bg-[var(--lp-cream)]">
      <div className="lp-bunting" aria-hidden />
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-5 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-8">
        <div>
          <p className="lp-display text-[2.25rem] leading-[0.9] text-[var(--lp-ink)]">
            USA <span className="text-[var(--lp-red)]">★</span> Gummies.
          </p>
          <p className="lp-script mt-1 text-[1.6rem] text-[var(--lp-red)]">
            Made in the U.S.A.
          </p>
          <p className="lp-sans mt-3 max-w-[32ch] text-[1rem] font-normal text-[var(--lp-ink)]/80">
            All-natural gummy bears. Sourced, made, and packed in the U.S.A.
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
      <div className="lp-starfield">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-2 px-5 py-4 sm:flex-row sm:px-8">
          <span className="lp-label text-[var(--lp-off-white)]/80">
            © USA Gummies · Ashford, WA · Est. 2025
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
