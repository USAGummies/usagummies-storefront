import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "America 250 Gifts",
  description:
    "America 250 gifts — patriotic gummy bundles built for hosting, gifting, and sharing.",
  alternates: { canonical: "/america-250/gifts" },
};

export default function America250GiftsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/america-250" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            ← Back to America 250
          </Link>
          <Link href="/shop" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Shop →
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 gifts</h1>
        <p className="mt-4 text-[var(--muted)]">
          Simple, gift-ready bundles with an Americana feel — built to show up looking premium.
        </p>

        <div className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6">
          <div className="text-sm font-semibold">Quick picks</div>
          <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
            <li>• 5 bags: easy gift, Free shipping on 5+ bags</li>
            <li>• 8 bags: most popular for hosting + sharing</li>
            <li>• 12 bags: stock-up / party table</li>
          </ul>

          <p className="mt-4 text-xs text-[var(--muted)]">
            Tip: Use <span className="font-semibold text-[var(--text)]">?campaign=america250</span> for the special naming mode.
          </p>
        </div>
      </div>
    </main>
  );
}
