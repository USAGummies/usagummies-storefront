export const AMAZON_REVIEWS = {
  source: "amazon",
  asin: "B0G1JK92TJ",
  listingUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  aggregate: { rating: 4.8, count: 2000 },
  reviews: [],
} as const;

export type AmazonReviews = typeof AMAZON_REVIEWS;
export type AmazonReview = (typeof AMAZON_REVIEWS.reviews)[number];
