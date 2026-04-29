// Real customer reviews — unified source-of-truth.
// 2026-04-29 expansion: this file previously only held 7 legacy reviews
// (originally captured on the Squarespace site, then re-platformed). The
// 8 Amazon Vine reviews from src/data/reviews.amazon.json have now been
// folded in here so the entire site (incl. /go and JSON-LD) reflects all
// 15 real reviews.
//
// Honest aggregate (no rounding tricks):
//   12 × 5-star + 2 × 4-star + 1 × 2-star = 70 / 15 = 4.667 → 4.7
//
// Why the 2-star is INCLUDED (not hidden):
// Per Cialdini "Influence" + Mathews landing-page research, mixed reviews
// (a 4★ + a 2★ alongside many 5★) signal HIGHER trust than uniform 5★.
// Critical reviews build credibility. We display them.
//
// Variable name kept as AMAZON_REVIEWS for blast-radius reasons (~10
// consumers across the codebase). Rename to CUSTOMER_REVIEWS in a later
// pass if/when the consumer surface stabilizes.
//
// Source labels per review:
//   - "verified" : real DTC purchase from the Squarespace era (legacy 7)
//   - "vine"     : Amazon Vine reviewer (received free product, honest review)
// Display logic on /go must distinguish: don't claim "verified buyer" on Vine.
//
// IMPORTANT: When adding new reviews, also confirm that JSON-LD product
// schema served via src/lib/reviews/aggregate.ts is reading the right data.

export type ReviewProgram = "verified" | "vine";

export type CustomerReview = {
  id: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  dateISO: string;
  program: ReviewProgram;
  verified: boolean;
  helpfulCount: number;
  productLabel?: string;
  sourceUrl?: string;
};

// Order matters: first 3 are surfaced on /go (slice 0..3).
// Intentional mix → 1 strong 5★ Vine, 1 strong 5★ verified, 1 thoughtful 4★.
// This gives the page credibility-balanced social proof per Cialdini/Mathews.
const reviewList: CustomerReview[] = [
  {
    id: "amzn-jeff-dempsey-2025-12-13",
    rating: 5,
    title: "The absolute best gummy bears I've ever had",
    body: "I wish I could give these more than 5 stars! Delicious flavors with absolutely no aftertaste, made in the USA, and the watermelon tastes like a summer picnic.",
    authorName: "Jeff Dempsey",
    dateISO: "2025-12-13",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "legacy-michael-d-2025-12-08",
    rating: 5,
    title: "American pride in a bag",
    body: "Absolutely delicious soft gummy bears made in America packaged in a unique bag displaying American pride in American products and American workers! Support a small business right here in America by giving these gummies a try, you will not be disappointed!",
    authorName: "Michael D",
    dateISO: "2025-12-08",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "amzn-ajc23-2025-12-16",
    rating: 4,
    title: "Better than artificial — for you",
    body: "Good flavor overall, high quality, a bit larger than typical gummies. No artificial dyes or flavors — you can really taste the real fruit. Pricier, but a premium product.",
    authorName: "AJC23",
    dateISO: "2025-12-16",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-courtney-b-2025-12-19",
    rating: 5,
    title: "If you're a gummy enthusiast you need to try these",
    body: "Soft and fresh with a pleasant, STRONG flavor. Ingredient list is short. Absolutely would get these again.",
    authorName: "Courtney B",
    dateISO: "2025-12-19",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-pharmacy-finds-2025-12-23",
    rating: 5,
    title: "Juicy natural flavor — love these gummies",
    body: "Great consistency — medium hardness with a great toothy-ness. Five flavors, super fresh and juicy, more like natural fruits, all-American packaging.",
    authorName: "Pharmacy Finds",
    dateISO: "2025-12-23",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-kris-l-2025-12-20",
    rating: 5,
    title: "Great texture and flavor",
    body: "Some of the best gummies I've had. Perfect texture, very fresh, great flavors with no weird aftertaste. Slightly larger than average.",
    authorName: "Kris L.",
    dateISO: "2025-12-20",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-rose-fetner-2025-12-12",
    rating: 5,
    title: "Adorable gummies, packed with flavor",
    body: "Made in the USA with no artificial ingredients. Bold, juicy taste, super cute gummies. Heads-up: lots of sugar — more indulgent than everyday snack.",
    authorName: "rose fetner",
    dateISO: "2025-12-12",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-jm-2025-12-13",
    rating: 4,
    title: "The taste is amazing",
    body: "One of the best gummies I've had. Real fruit flavors, no chemical taste. Wanted more — ate the whole bag.",
    authorName: "JM",
    dateISO: "2025-12-13",
    program: "vine",
    verified: false,
    helpfulCount: 0,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "amzn-jandj-2025-12-17",
    rating: 2,
    title: "Fruity flavor, bouncy chew",
    body: "Tastes like real fruit, but the chew is rubbery. Packaging looks like jerky, not candy. Plant-based friendly.",
    authorName: "J&J",
    dateISO: "2025-12-17",
    program: "vine",
    verified: false,
    helpfulCount: 1,
    productLabel: "Amazon listing (ASIN B0G1JK92TJ)",
    sourceUrl: "https://www.amazon.com/dp/B0G1JK92TJ",
  },
  {
    id: "legacy-rene-g-2026-01-05",
    rating: 5,
    title: "Stocking-stuffer perfect",
    body: "Gummies arrived in time for Christmas. Nice stocking stuffers for my kids! The gummies are fresh and very good! Definitely will order more!!!",
    authorName: "Rene G",
    dateISO: "2026-01-05",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "legacy-tommie-o-2025-12-01",
    rating: 5,
    title: "Outstanding",
    body: "They are outstanding, I will order more in the future.",
    authorName: "Tommie O",
    dateISO: "2025-12-01",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "legacy-ryan-m-2025-11-11",
    rating: 5,
    title: "Super fast",
    body: "Super fast and easy.",
    authorName: "Ryan M",
    dateISO: "2025-11-11",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "legacy-beau-m-2025-11-10",
    rating: 5,
    title: "Soft and fresh",
    body: "Quick order fulfillment and shipping, with a great tasting, soft, and fresh gummy bears. I'll order again.",
    authorName: "Beau M",
    dateISO: "2025-11-10",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "legacy-craig-b-2025-11-04",
    rating: 5,
    title: "Will reorder",
    body: "Love them gummies, will be ordering regularly.",
    authorName: "Craig B",
    dateISO: "2025-11-04",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
  {
    id: "legacy-niki-l-2025-11-01",
    rating: 5,
    title: "Next-level flavor",
    body: "Just tried USA Gummies and they are amazing! The flavor and texture is next level and addicting. I will definitely get them again!",
    authorName: "Niki L",
    dateISO: "2025-11-01",
    program: "verified",
    verified: true,
    helpfulCount: 0,
  },
];

// Compute aggregate from the actual data — no hardcoded magic numbers.
function computeAggregate(list: CustomerReview[]) {
  const sum = list.reduce((acc, r) => acc + r.rating, 0);
  const ratingValue = Math.round((sum / list.length) * 10) / 10;
  return { rating: ratingValue, count: list.length };
}

export const AMAZON_REVIEWS = {
  source: "amazon",
  asin: "B0G1JK92TJ",
  listingUrl: "https://www.amazon.com/dp/B0G1JK92TJ?maas=maas_adg_BA724FDB5D62533",
  aggregate: computeAggregate(reviewList),
  reviews: reviewList,
} as const;

export type AmazonReviews = typeof AMAZON_REVIEWS;
export type AmazonReview = (typeof AMAZON_REVIEWS.reviews)[number];
