// Minimal footer — monumental mark, four links, legal line. That's it.

import Link from "next/link";

export function FooterMini() {
  return (
    <footer className="relative border-t border-[var(--lp-rule)]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-5 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-8">
        <div>
          <p className="lp-display text-[2rem] leading-[0.9]">
            USA <span className="text-[var(--lp-blood)]">Gummies.</span>
          </p>
          <p className="lp-editorial mt-3 max-w-[32ch] text-[1.05rem] text-[var(--lp-ink)]/80">
            Dye-free gummy bears, pressed in America. Shipped from Mt.
            Rainier country.
          </p>
        </div>
        <nav aria-label="Shop" className="space-y-2">
          <p className="lp-mono mb-2 text-[var(--lp-ink)]/60">Shop</p>
          <Link href="/shop" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            All products
          </Link>
          <Link href="/wholesale" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            Wholesale
          </Link>
          <Link href="/bulk-gummy-bears" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            Bulk orders
          </Link>
        </nav>
        <nav aria-label="Company" className="space-y-2">
          <p className="lp-mono mb-2 text-[var(--lp-ink)]/60">Company</p>
          <Link href="/about" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            About
          </Link>
          <Link href="/ingredients" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            Ingredients
          </Link>
          <Link href="/contact" className="block text-[1rem] text-[var(--lp-ink)] hover:text-[var(--lp-blood)]">
            Contact
          </Link>
        </nav>
      </div>
      <div className="border-t border-[var(--lp-rule)]">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-2 px-5 py-4 text-[var(--lp-ink)]/60 sm:flex-row sm:px-8">
          <span className="lp-mono">
            © USA Gummies · Ashford, WA · Est. 2025
          </span>
          <span className="lp-mono flex gap-4">
            <Link href="/policies/terms">Terms</Link>
            <Link href="/policies/privacy">Privacy</Link>
            <Link href="/policies/returns">Returns</Link>
          </span>
        </div>
      </div>
      <div className="pb-28 md:pb-0" aria-hidden />
    </footer>
  );
}
