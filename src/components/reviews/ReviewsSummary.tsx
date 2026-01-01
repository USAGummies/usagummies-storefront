import { AMAZON_REVIEWS } from "@/data/amazonReviews";

export function ReviewsSummary() {
  const a = AMAZON_REVIEWS.aggregate;
  const txt = `${a.rating.toFixed(1)} from ${a.count.toLocaleString()}+ reviews on Amazon`;
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-sm font-semibold text-white">⭐ {txt}</div>
      <div className="mt-1 text-xs text-white/70">Premium social proof. Real customers. Real taste.</div>
    </div>
  );
}
