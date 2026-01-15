import { AMAZON_REVIEWS } from "@/data/amazonReviews";

export function ReviewsSummary() {
  const a = AMAZON_REVIEWS.aggregate;
  const txt = `${a.rating.toFixed(1)} stars from verified Amazon buyers`;
  return (
    <div className="candy-panel rounded-2xl px-4 py-3">
      <div className="text-sm font-semibold text-[var(--text)]">⭐ {txt}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">Premium social proof. Real customers. Real taste.</div>
    </div>
  );
}
