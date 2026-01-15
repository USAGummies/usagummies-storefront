"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm opacity-80">
        Try refreshing. If it keeps happening, the dev overlay was failing to load the required error components.
      </p>
      <button
        className="btn btn-outline mt-6 rounded-full px-4 py-2 text-sm font-medium"
        onClick={() => reset()}
      >
        Try again
      </button>
      <pre className="mt-6 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-xs">
        {String(error?.message || error)}
      </pre>
    </div>
  );
}
