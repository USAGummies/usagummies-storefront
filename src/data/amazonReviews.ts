// Real Amazon reviews — pulled from src/data/reviews.legacy.json which is the
// historical source of truth. The previous version of this file fabricated
// 12 reviews and inflated the count to "2000+ verified buyers", which was an
// FTC §255 disclosure violation and a Meta Ads policy violation. Killed
// 2026-04-29 as part of the comprehensive site audit.
//
// All 7 entries below are real reviews from the actual Amazon listing
// (ASIN B0G1JK92TJ). All 7 are 5-star → aggregate.rating = 5.0 (not 4.8).
// reviewCount: 7 matches the Product JSON-LD schema served on the same pages.
//
// When new Amazon reviews come in, append them here AND update both the
// aggregate count and the JSON-LD product schema simultaneously.

export const AMAZON_REVIEWS = {
  source: "amazon",
  asin: "B0G1JK92TJ",
  listingUrl: "https://www.amazon.com/dp/B0G1JK92TJ?maas=maas_adg_BA724FDB5D62533",
  aggregate: { rating: 5.0, count: 7 },
  reviews: [
    {
      id: "amz-rene-g-2026-01-05",
      rating: 5,
      title: "Stocking-stuffer perfect",
      body: "Gummies arrived in time for Christmas. Nice stocking stuffers for my kids! The gummies are fresh and very good! Definitely will order more!!!",
      authorName: "Rene G",
      dateISO: "2026-01-05",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-michael-d-2025-12-08",
      rating: 5,
      title: "American pride in a bag",
      body: "Absolutely delicious soft gummy bears made in America packaged in a unique bag displaying American pride in American products and American workers! What more could you want!? Support a small business right here in America by giving these gummies a try, you will not be disappointed!!",
      authorName: "Michael D",
      dateISO: "2025-12-08",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-tommie-o-2025-12-01",
      rating: 5,
      title: "Outstanding",
      body: "They are outstanding, I will order more in the future.",
      authorName: "Tommie O",
      dateISO: "2025-12-01",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-ryan-m-2025-11-11",
      rating: 5,
      title: "Super fast",
      body: "Super fast and easy.",
      authorName: "Ryan M",
      dateISO: "2025-11-11",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-beau-m-2025-11-10",
      rating: 5,
      title: "Soft and fresh",
      body: "Quick order fulfillment and shipping, with a great tasting, soft, and fresh gummy bears. I'll order again.",
      authorName: "Beau M",
      dateISO: "2025-11-10",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-craig-b-2025-11-04",
      rating: 5,
      title: "Will reorder",
      body: "Love them gummies, will be ordering regularly.",
      authorName: "Craig B",
      dateISO: "2025-11-04",
      verified: true,
      helpfulCount: 0,
    },
    {
      id: "amz-niki-l-2025-11-01",
      rating: 5,
      title: "Next-level flavor",
      body: "Just tried USA Gummies and they are amazing! The flavor and texture is next level and addicting. I will definitely get them again!",
      authorName: "Niki L",
      dateISO: "2025-11-01",
      verified: true,
      helpfulCount: 0,
    },
  ],
} as const;

export type AmazonReviews = typeof AMAZON_REVIEWS;
export type AmazonReview = (typeof AMAZON_REVIEWS.reviews)[number];
