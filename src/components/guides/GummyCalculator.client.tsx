"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { cn } from "@/lib/cn";
import { pricingForQty, FREE_SHIP_QTY, BASE_PRICE } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";

const EVENT_TYPES = [
  { key: "party", label: "🎉 Party", servingsPerGuest: 12 },
  { key: "wedding", label: "💒 Wedding / Event", servingsPerGuest: 10 },
  { key: "gift", label: "🎁 Gift bags", servingsPerGuest: 15 },
  { key: "office", label: "🏢 Office / Team", servingsPerGuest: 8 },
  { key: "classroom", label: "🏫 Classroom", servingsPerGuest: 6 },
] as const;

const GUMMIES_PER_BAG = 50;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function GummyCalculator() {
  const [guests, setGuests] = useState(20);
  const [eventType, setEventType] = useState<string>("party");

  const event = EVENT_TYPES.find((e) => e.key === eventType) ?? EVENT_TYPES[0];
  const totalGummies = guests * event.servingsPerGuest;
  const rawBags = Math.ceil(totalGummies / GUMMIES_PER_BAG);
  const recommendedBags = clamp(rawBags, 1, 100);

  const pricing = useMemo(() => pricingForQty(recommendedBags), [recommendedBags]);
  const totalCost = pricing.total;
  const savingsPerBag = BASE_PRICE - pricing.perBag;
  const totalSavings = savingsPerBag * recommendedBags;
  const freeShipping = recommendedBags >= FREE_SHIP_QTY;

  function handleCalculate() {
    trackEvent("gummy_calculator_used", {
      guests,
      event_type: eventType,
      recommended_bags: recommendedBags,
    });
  }

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
            Number of guests
          </label>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setGuests((g) => Math.max(1, g - 5))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] text-lg font-bold text-[var(--text)] transition hover:bg-white"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={500}
              value={guests}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setGuests(clamp(v, 1, 500));
              }}
              onBlur={handleCalculate}
              className="h-10 w-20 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] text-center text-lg font-black text-[var(--text)]"
            />
            <button
              type="button"
              onClick={() => setGuests((g) => Math.min(500, g + 5))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] text-lg font-bold text-[var(--text)] transition hover:bg-white"
            >
              +
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
            Event type
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {EVENT_TYPES.map((et) => (
              <button
                key={et.key}
                type="button"
                onClick={() => {
                  setEventType(et.key);
                  handleCalculate();
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  et.key === eventType
                    ? "border-[rgba(239,59,59,0.45)] bg-[rgba(239,59,59,0.12)] text-[var(--candy-red)]"
                    : "border-[var(--border)] bg-[var(--surface-strong)] text-[var(--text)] hover:bg-white"
                )}
              >
                {et.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="rounded-3xl border border-[var(--border)] bg-white p-5 sm:p-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
          Our recommendation
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="text-4xl font-black text-[var(--text)]">
            {recommendedBags}
          </div>
          <div className="text-lg font-semibold text-[var(--muted)] pb-0.5">
            bag{recommendedBags === 1 ? "" : "s"}
          </div>
        </div>
        <div className="mt-2 text-sm text-[var(--muted)]">
          That&apos;s ~{totalGummies.toLocaleString()} gummies for {guests} guests
          ({event.servingsPerGuest} each).
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Per bag
            </div>
            <div className="mt-1 text-lg font-black text-[var(--text)]">
              ${pricing.perBag.toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Total
            </div>
            <div className="mt-1 text-lg font-black text-[var(--text)]">
              ${totalCost.toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Shipping
            </div>
            <div className={cn("mt-1 text-lg font-black", freeShipping ? "text-[var(--candy-green,#22c55e)]" : "text-[var(--muted)]")}>
              {freeShipping ? "Free" : "Via Amazon"}
            </div>
          </div>
        </div>

        {totalSavings > 0.01 ? (
          <div className="mt-3 rounded-xl border border-[rgba(239,59,59,0.2)] bg-[rgba(239,59,59,0.06)] p-3 text-center text-sm font-semibold text-[var(--candy-red)]">
            You save ${totalSavings.toFixed(2)} vs buying individually
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/shop" className="btn btn-candy pressable">
            Shop {recommendedBags} bags
          </Link>
          <Link href="/wholesale" className="btn btn-outline">
            Need more? Go wholesale
          </Link>
        </div>
      </div>

      {/* How we calculated */}
      <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">
          How we calculated this
        </summary>
        <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
          <p>
            Each 7.5 oz bag contains ~{GUMMIES_PER_BAG} gummy bears. We estimate {event.servingsPerGuest} gummies
            per guest for a {event.label.replace(/^[^\s]+\s/, "").toLowerCase()}.
          </p>
          <p>
            {guests} guests × {event.servingsPerGuest} gummies = {totalGummies} total ÷ {GUMMIES_PER_BAG} per bag = {rawBags} bags.
          </p>
          <p>
            Orders of 5+ bags ship free directly from us. Under 5 bags, we send you to
            Amazon so you still get fast, affordable shipping.
          </p>
        </div>
      </details>
    </div>
  );
}
