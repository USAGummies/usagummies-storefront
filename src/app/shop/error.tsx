// src/app/shop/error.tsx
"use client";

import Link from "next/link";

export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">
          Shop is having a moment
        </h1>

        <p className="mt-3 text-neutral-700">
          Something went wrong loading products. Try again.
        </p>

        <details className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
            Technical details
          </summary>
          <pre className="mt-3 overflow-auto text-xs text-neutral-800">
            {error.message}
          </pre>
        </details>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Retry
          </button>

          <Link
            href="/"
            className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
