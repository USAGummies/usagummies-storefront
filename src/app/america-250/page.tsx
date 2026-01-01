import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "America 250",
  description:
    "America 250 hub — patriotic gummy gifts and bundle drops built for celebrating America’s 250th.",
  alternates: { canonical: "/america-250" },
};

export default function America250HubPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/shop" className="text-sm text-white/70 hover:text-white">
            ← Back to shop
          </Link>
          <Link href="/cart" className="text-sm text-white/70 hover:text-white">
            View cart →
          </Link>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">
          <span className="font-semibold tracking-wide">AMERICA 250</span>
          <span className="text-white/40">•</span>
          <span className="text-white/80">Hub</span>
        </div>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight">America 250</h1>
        <p className="mt-4 text-white/75">
          A focused hub for gifts, celebrations, and events tied to America’s 250th — with
          limited-run gummy bundles built for sharing.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Link
            href="/america-250/gifts"
            className="rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10"
          >
            <div className="text-lg font-semibold">Gifts</div>
            <div className="mt-2 text-sm text-white/70">
              Patriotic gummy gift ideas and bundle picks.
            </div>
          </Link>

          <Link
            href="/america-250/celebrations"
            className="rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10"
          >
            <div className="text-lg font-semibold">Celebrations</div>
            <div className="mt-2 text-sm text-white/70">
              Party ideas, parade snacks, and shareable bundles.
            </div>
          </Link>

          <Link
            href="/america-250/events"
            className="rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10"
          >
            <div className="text-lg font-semibold">Events</div>
            <div className="mt-2 text-sm text-white/70">
              A simple page to pair with event-focused content.
            </div>
          </Link>
        </div>

        <div className="mt-10 rounded-3xl border border-white/10 bg-black/30 p-6">
          <div className="text-sm font-semibold text-white">Want the America 250 bundle view?</div>
          <p className="mt-2 text-sm text-white/70">
            Add <span className="font-semibold text-white">?campaign=america250</span> to any product page.
          </p>
          <Link
            href="/shop"
            className="mt-4 inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
          >
            Shop bundles
          </Link>
        </div>
      </div>
    </main>
  );
}
