"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortValue =
  | "featured"
  | "best-selling"
  | "price-asc"
  | "price-desc"
  | "newest";

const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "best-selling", label: "Best selling" },
  { value: "newest", label: "New arrivals" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

function sortLabel(sort: SortValue) {
  const found = SORT_OPTIONS.find((o) => o.value === sort);
  return found?.label ?? "Featured";
}

function clampSort(v: string | null): SortValue {
  switch (v) {
    case "featured":
    case "best-selling":
    case "price-asc":
    case "price-desc":
    case "newest":
      return v;
    default:
      return "featured";
  }
}

function normalizeQuery(s: string) {
  return s.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function ShopToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Read current URL state
  const sort = clampSort(sp.get("sort"));
  const q = sp.get("q") || "";

  // Local input state so we can debounce updates
  const [input, setInput] = useState(q);

  // Keep input in sync if user navigates back/forward or clears filters elsewhere
  useEffect(() => {
    setInput(q);
  }, [q]);

  const queryString = useMemo(() => sp.toString(), [sp]);

  function pushParams(next: URLSearchParams) {
    // Reset pagination whenever search/sort changes
    next.delete("after");
    next.delete("before");

    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(queryString);

    if (value === null || value.trim() === "") next.delete(key);
    else next.set(key, value);

    pushParams(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    pushParams(next);
  }

  // Debounce search → update URL after pause
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    const normalized = normalizeQuery(input);
    const current = normalizeQuery(q);

    // If input matches URL already, do nothing
    if (normalized === current) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setParam("q", normalized ? normalized : null);
    }, 350);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, q, queryString]); // include q/queryString to avoid stale updates

  // Submit immediately on Enter (no waiting for debounce)
  function submitNow() {
    const normalized = normalizeQuery(input);
    const current = normalizeQuery(q);
    if (normalized === current) return;
    setParam("q", normalized ? normalized : null);
  }

  const hasQuery = normalizeQuery(q).length > 0;
  const hasNonDefaultSort = sort !== "featured";
  const hasAnyFilters = hasQuery || hasNonDefaultSort;

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {/* Search */}
        <div className="w-full sm:max-w-md">
          <label className="block text-sm font-medium text-neutral-700">
            Search
          </label>

          <div className="mt-1 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNow();
                if (e.key === "Escape") setInput("");
              }}
              placeholder="Search gummies…"
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2 text-base outline-none focus:border-neutral-400"
              inputMode="search"
              aria-label="Search products"
            />

            {input.trim().length > 0 ? (
              <button
                type="button"
                onClick={() => setInput("")}
                className="shrink-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
                aria-label="Clear search input"
              >
                Clear
              </button>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-neutral-500">
            Tip: try “sour”, “bundle”, or “new”. Press Enter to submit instantly.
          </p>
        </div>

        {/* Sort */}
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-neutral-700">
            Sort
          </label>
          <select
            value={sort}
            onChange={(e) => setParam("sort", e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2 text-base outline-none focus:border-neutral-400"
            aria-label="Sort products"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {isPending && (
            <p className="mt-1 text-xs text-neutral-500">Updating…</p>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-500">Active:</span>

        {hasQuery ? (
          <button
            type="button"
            onClick={() => setParam("q", null)}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-900 hover:bg-neutral-50"
            aria-label="Remove search filter"
            title="Remove search filter"
          >
            <span className="text-neutral-500">Search:</span>
            <span className="font-semibold">“{q}”</span>
            <span className="text-neutral-400">✕</span>
          </button>
        ) : (
          <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-700">
            Search: <span className="ml-1 text-neutral-500">none</span>
          </span>
        )}

        {hasNonDefaultSort ? (
          <button
            type="button"
            onClick={() => setParam("sort", null)}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-900 hover:bg-neutral-50"
            aria-label="Reset sort"
            title="Reset sort"
          >
            <span className="text-neutral-500">Sort:</span>
            <span className="font-semibold">{sortLabel(sort)}</span>
            <span className="text-neutral-400">✕</span>
          </button>
        ) : (
          <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm text-neutral-700">
            Sort:{" "}
            <span className="ml-1 text-neutral-500">{sortLabel(sort)}</span>
          </span>
        )}

        {hasAnyFilters ? (
          <button
            type="button"
            onClick={clearAll}
            className="ml-0 inline-flex items-center rounded-full bg-neutral-900 px-3 py-1 text-sm font-semibold text-white hover:opacity-90"
          >
            Clear all
          </button>
        ) : null}

        <span className="ml-auto text-xs text-neutral-500">
          URLs update automatically (shareable & SEO-friendly).
        </span>
      </div>
    </div>
  );
}
