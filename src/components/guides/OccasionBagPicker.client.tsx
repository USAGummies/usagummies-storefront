"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type Pick = {
  title: string;
  detail: string;
  qty?: number;
  ctaLabel?: string;
  ctaHref?: string;
};

export type OccasionOption = {
  key: string;
  label: string;
  headline: string;
  picks: Pick[];
  note?: string;
};

type Props = {
  options: OccasionOption[];
  defaultKey?: string;
  title?: string;
  singleBagVariantId?: string;
};

export function OccasionBagPicker({
  options,
  defaultKey,
  title = "Quick picks by occasion",
  singleBagVariantId,
}: Props) {
  const fallbackKey = options[0]?.key || "gift";
  const [activeKey, setActiveKey] = useState(defaultKey || fallbackKey);
  const [addingQty, setAddingQty] = useState<number | null>(null);
  const [successQty, setSuccessQty] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeOption = useMemo(
    () => options.find((opt) => opt.key === activeKey) || options[0],
    [activeKey, options]
  );

  useEffect(() => {
    if (!successQty) return;
    const timer = window.setTimeout(() => setSuccessQty(null), 2000);
    return () => window.clearTimeout(timer);
  }, [successQty]);

  async function handleAdd(qty: number) {
    if (!singleBagVariantId) {
      setError("Out of stock.");
      return;
    }
    setAddingQty(qty);
    setError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId: singleBagVariantId,
          merchandiseId: singleBagVariantId,
          quantity: qty,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Couldn't add to cart.");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      setSuccessQty(qty);
    } catch (err: any) {
      setError(err?.message || "Could not add to cart.");
    } finally {
      setAddingQty(null);
    }
  }

  if (!activeOption) return null;

  return (
    <div className="rounded-3xl border border-[rgba(15,27,45,0.12)] bg-white p-4 sm:p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--muted)]">
        {title}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => {
          const isActive = opt.key === activeKey;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setActiveKey(opt.key)}
              aria-pressed={isActive}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                isActive
                  ? "border-[rgba(239,59,59,0.45)] bg-[rgba(239,59,59,0.12)] text-[var(--candy-red)]"
                  : "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--text)] hover:bg-white"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-sm font-semibold text-[var(--text)]">{activeOption.headline}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {activeOption.picks.map((pick) => {
          const qty = pick.qty;
          const hasQty = Number.isFinite(qty);
          const isAdding = hasQty && addingQty === qty;
          const isSuccess = hasQty && successQty === qty;
          const ctaLabel = pick.ctaLabel || (hasQty ? `Add ${qty} bags` : "Contact us");
          return (
          <div
            key={pick.title}
            className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3"
          >
            <div className="text-xs font-semibold text-[var(--text)]">{pick.title}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">{pick.detail}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {pick.ctaHref ? (
                <Link href={pick.ctaHref} className="btn btn-outline btn-compact">
                  {ctaLabel}
                </Link>
              ) : hasQty ? (
                <button
                  type="button"
                  onClick={() => handleAdd(qty!)}
                  disabled={isAdding}
                  className={cn(
                    "btn btn-outline btn-compact",
                    isAdding ? "opacity-70 cursor-wait" : "",
                    isSuccess ? "border-[rgba(34,197,94,0.6)] text-[rgba(34,197,94,0.9)]" : ""
                  )}
                >
                  {isSuccess ? "Added" : isAdding ? "Adding..." : ctaLabel}
                </button>
              ) : null}
            </div>
          </div>
        );
        })}
      </div>
      {activeOption.note ? (
        <div className="mt-3 text-[11px] text-[var(--muted)]">{activeOption.note}</div>
      ) : null}
      {error ? (
        <div className="mt-2 text-[11px] font-semibold text-[var(--candy-red)]">{error}</div>
      ) : null}
    </div>
  );
}
