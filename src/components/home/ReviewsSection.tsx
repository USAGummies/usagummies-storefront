import "server-only";
import ReviewsSectionClient, { type Review } from "./ReviewsSection.client";
import legacyData from "@/data/reviews.legacy.json";
import { fetchVerifiedReviews } from "@/lib/shopify/fetchVerifiedReviews";

type LegacyReviewShape = {
  id: string;
  rating: number;
  title?: string;
  body: string;
  authorName: string;
  dateISO?: string;
  productLabel?: string;
  helpfulCount?: number;
};

function normalizeLegacy(): Review[] {
  return (legacyData as LegacyReviewShape[])
    .map((r) => ({
      id: r.id,
      source: "legacy" as const,
      rating: Number(r.rating) || 0,
      title: r.title || undefined,
      body: r.body || "",
      authorName: r.authorName || "Customer",
      dateISO: r.dateISO || "",
      productLabel: r.productLabel || "All American Gummy Bears",
      verified: true,
      helpfulCount:
        Number.isFinite(Number(r.helpfulCount)) && r.helpfulCount !== undefined
          ? Number(r.helpfulCount)
          : undefined,
    }))
    .filter((r) => r.rating > 0 && r.dateISO);
}

export default async function ReviewsSection() {
  const legacy = normalizeLegacy();
  let shopify: Review[] = [];
  try {
    shopify = await fetchVerifiedReviews();
  } catch {
    shopify = [];
  }

  const reviews = [...legacy, ...shopify]
    .filter((r) => r.verified)
    .sort((a, b) => {
      const bDate = b.dateISO ? Date.parse(b.dateISO) : 0;
      const aDate = a.dateISO ? Date.parse(a.dateISO) : 0;
      return bDate - aDate;
    });

  return <ReviewsSectionClient reviews={reviews} />;
}
