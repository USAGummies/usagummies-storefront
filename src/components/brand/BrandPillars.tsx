// src/components/brand/BrandPillars.tsx (FULL REPLACE)
export default function BrandPillars({ size = "md" }: { size?: "sm" | "md" }) {
  const pill =
    size === "sm"
      ? "px-2.5 py-1 text-[11px]"
      : "px-3 py-1.5 text-xs";

  return (
    <div className="flex flex-wrap gap-2">
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 ${pill}`}
      >
        🇺🇸 <span className="font-semibold">Made in America</span>
      </span>
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 ${pill}`}
      >
        🌱 <span className="font-semibold">All Natural</span>
      </span>
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 ${pill}`}
      >
        🚫 <span className="font-semibold">Artificial Dye Free</span>
      </span>
    </div>
  );
}
