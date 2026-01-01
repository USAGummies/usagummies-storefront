import { AMAZON_REVIEWS } from "@/data/amazonReviews";

export const getAmazonAggregate = () => AMAZON_REVIEWS.aggregate;
export const getAmazonHighlights = (limit = 6) => {
  const all = [...(AMAZON_REVIEWS.reviews || [])] as any[];
  all.sort((a, b) => (b?.stars || 0) - (a?.stars || 0));
  return all.slice(0, limit);
};
export const hasAmazonReviews = () => (AMAZON_REVIEWS.reviews?.length || 0) > 0;
