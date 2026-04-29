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
  // Only expose raw error.message in development — in production it
  // can leak stack traces and internal paths to end users.
  const isDev = process.env.NODE_ENV === "development";

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">
          Shop is having a moment
        </h1>

        <p className="mt-3 text-neutral-700">
          Something went wrong loading products. Please refresh or contact support.
        </p>

        {isDev ? (
          <details className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
              Technical details
            </summary>
            <pre className="mt-3 overflow-auto text-xs text-neutral-800">
              {error.message}
            </pre>
          </details>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => reset()}
            className="btn btn-candy rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Retry
          </button>

          <Link
            href="/"
            className="btn btn-outline rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Go home
          </Link>
        </div>
      </div>
      </div>
    </main>
  );
}
