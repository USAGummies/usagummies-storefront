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
        className="mt-6 rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15"
        onClick={() => reset()}
      >
        Try again
      </button>
      <pre className="mt-6 whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-xs">
        {String(error?.message || error)}
      </pre>
    </div>
  );
}
