import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "America 250 Events",
  description:
    "America 250 events — simple event-focused page for SEO and campaign landing use.",
  alternates: { canonical: "/america-250/events" },
};

export default function America250EventsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-14">
        <div className="mb-6">
          <Link href="/america-250" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
            ← Back to America 250
          </Link>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">America 250 events</h1>
        <p className="mt-4 text-[var(--muted)]">
          This page exists for event-intent traffic and internal linking. You can expand it later
          with specific city / date content.
        </p>

        <div className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6">
          <div className="text-sm font-semibold">Next upgrade (optional)</div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            We can add a lightweight “events index” component and feed it from a simple JSON list
            so it stays fast and doesn’t need a CMS.
          </p>
        </div>
      </div>
    </main>
  );
}
