// src/components/brand/BrandMarks.tsx
import React from "react";

export function PillarBar({
  className = "",
  small = false,
}: {
  className?: string;
  small?: boolean;
}) {
  return (
    <div
      className={[
        "inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/25",
        small ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-xs",
        "font-semibold uppercase tracking-wide text-white/90",
        className,
      ].join(" ")}
      aria-label="USA Gummies brand pillars"
    >
      <span>All Natural</span>
      <span className="text-amber-400" aria-hidden>
        ★
      </span>
      <span>No Artificial Dyes</span>
      <span className="text-amber-400" aria-hidden>
        ★
      </span>
      <span>Made in the USA</span>
    </div>
  );
}

export function StarDivider({ className = "" }: { className?: string }) {
  return (
    <div className={["flex items-center justify-center gap-4", className].join(" ")}>
      <div className="h-px w-20 bg-white/10" />
      <div className="flex items-center gap-2 text-amber-400" aria-hidden>
        <span>★</span>
        <span>★</span>
        <span>★</span>
      </div>
      <div className="h-px w-20 bg-white/10" />
    </div>
  );
}
