import "server-only";
import legacyData from "@/data/reviews.legacy.json";
import amazonVineData from "@/data/reviews.amazon.json";
import { fetchVerifiedReviews } from "@/lib/shopify/fetchVerifiedReviews";

type ReviewLike = { rating: number };

function normalizeJson(data: unknown): ReviewLike[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((r: unknown) => ({ rating: Number((r as { rating?: number })?.rating) || 0 }))
    .filter((r) => r.rating > 0);
}

export async function getReviewAggregate() {
  const legacy = normalizeJson(legacyData);
  const vine = normalizeJson(amazonVineData);

  let shopify: ReviewLike[] = [];
  try {
    const fetched = await fetchVerifiedReviews();
    shopify = fetched.map((r) => ({ rating: Number(r.rating) || 0 })).filter((r) => r.rating > 0);
  } catch {
    shopify = [];
  }

  // Combine all real review sources. Vine reviews count toward the JSON-LD
  // aggregateRating because they're real reviews from real reviewers — they
  // just received free product. The display layer should still distinguish
  // "verified buyer" from "Amazon Vine" labels for honest UX.
  const all = [...legacy, ...vine, ...shopify].filter((r) => r.rating > 0);
  if (!all.length) return null;

  const sum = all.reduce((acc, r) => acc + r.rating, 0);
  const avg = Math.max(1, Math.min(5, sum / all.length));
  const ratingValue = Math.round(avg * 10) / 10;

  return {
    ratingValue,
    reviewCount: all.length,
  };
}
