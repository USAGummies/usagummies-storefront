"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type Pick = {
  title: string;
  detail: string;
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
};

export function OccasionBagPicker({
  options,
  defaultKey,
  title = "Occasion quick picks",
}: Props) {
  const fallbackKey = options[0]?.key || "gift";
  const [activeKey, setActiveKey] = useState(defaultKey || fallbackKey);
  const activeOption = useMemo(
    () => options.find((opt) => opt.key === activeKey) || options[0],
    [activeKey, options]
  );

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
        {activeOption.picks.map((pick) => (
          <div
            key={pick.title}
            className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3"
          >
            <div className="text-xs font-semibold text-[var(--text)]">{pick.title}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">{pick.detail}</div>
          </div>
        ))}
      </div>
      {activeOption.note ? (
        <div className="mt-3 text-[11px] text-[var(--muted)]">{activeOption.note}</div>
      ) : null}
    </div>
  );
}
