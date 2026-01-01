import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "America 250 Celebrations",
  description:
    "America 250 celebrations — party ideas and patriotic bundle snacks built for sharing.",
  alternates: { canonical: "/america-250/celebrations" },
};

export default function America250CelebrationsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="mb-6">
          <Link href="/america-250" className="text-sm text-white/70 hover:text-white">
            ← Back to America 250
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 celebrations</h1>
        <p className="mt-4 text-white/75">
          Built for parades, cookouts, road trips, and community events. Same premium gummies — just
          bundled and positioned for the moment.
        </p>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-sm font-semibold">Ways people use these</div>
          <ul className="mt-3 grid gap-2 text-sm text-white/75">
            <li>• Party favor bowls</li>
            <li>• Parade snack packs</li>
            <li>• Gift add-ons</li>
            <li>• Road trip stash</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
