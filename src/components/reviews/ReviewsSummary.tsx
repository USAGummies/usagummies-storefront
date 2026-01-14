import { AMAZON_REVIEWS } from "@/data/amazonReviews";

export function ReviewsSummary() {
  const a = AMAZON_REVIEWS.aggregate;
  const txt = `${a.rating.toFixed(1)} stars from verified Amazon buyers`;
  return (
    <div className="metal-panel rounded-2xl border border-white/12 px-4 py-3 text-white">
      <div className="text-sm font-semibold text-white">⭐ {txt}</div>
      <div className="mt-1 text-xs text-white/65">Premium social proof. Real customers. Real taste.</div>
    </div>
  );
}
