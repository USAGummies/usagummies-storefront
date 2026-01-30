import "server-only";
import legacyData from "@/data/reviews.legacy.json";
import { fetchVerifiedReviews } from "@/lib/shopify/fetchVerifiedReviews";

type ReviewLike = { rating: number };

function normalizeLegacy(): ReviewLike[] {
  return (legacyData as Array<{ rating?: number }>)
    .map((r) => ({ rating: Number(r.rating) || 0 }))
    .filter((r) => r.rating > 0);
}

export async function getReviewAggregate() {
  const legacy = normalizeLegacy();
  let shopify: ReviewLike[] = [];
  try {
    const fetched = await fetchVerifiedReviews();
    shopify = fetched.map((r) => ({ rating: Number(r.rating) || 0 })).filter((r) => r.rating > 0);
  } catch {
    shopify = [];
  }

  const all = [...legacy, ...shopify].filter((r) => r.rating > 0);
  if (!all.length) return null;

  const sum = all.reduce((acc, r) => acc + r.rating, 0);
  const avg = Math.max(1, Math.min(5, sum / all.length));
  const ratingValue = Math.round(avg * 10) / 10;

  return {
    ratingValue,
    reviewCount: all.length,
  };
}
