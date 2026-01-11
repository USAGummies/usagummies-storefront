import { AMAZON_REVIEWS } from "@/data/amazonReviews";

export function ReviewsSummary() {
  const a = AMAZON_REVIEWS.aggregate;
  const txt = `${a.rating.toFixed(1)} from ${a.count.toLocaleString()}+ reviews on Amazon`;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_12px_28px_rgba(15,27,45,0.12)]">
      <div className="text-sm font-semibold text-[var(--text)]">⭐ {txt}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">Premium social proof. Real customers. Real taste.</div>
    </div>
  );
}
