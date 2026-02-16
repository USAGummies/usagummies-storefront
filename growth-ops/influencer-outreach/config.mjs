// ============================================================================
// USA Gummies — Micro-Influencer Outreach Configuration
// ============================================================================

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
export const PATHS = {
  dataDir: join(__dirname, 'data'),
  influencersDb: join(__dirname, 'data', 'influencers.json'),
  interactionsDb: join(__dirname, 'data', 'interactions.json'),
  templatesDir: join(__dirname, 'templates'),
};

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------
export const BRAND = {
  name: 'USA Gummies',
  productName: 'All American Gummy Bears',
  website: 'https://usagummies.com',
  shopUrl: 'https://usagummies.com/shop',
  tagline: 'Made in the USA with zero artificial dyes.',
  founderName: 'Ben',              // used in DMs that come "from the founder"
  instagram: '@usagummies',
  tiktok: '@usagummies',
  email: 'hello@usagummies.com',
  shippingFrom: {
    name: 'USA Gummies',
    address1: '',                   // fill in real address
    city: '',
    state: '',
    zip: '',
    country: 'US',
  },
};

// ---------------------------------------------------------------------------
// Product tiers (cost of goods for ROI calculations)
// ---------------------------------------------------------------------------
export const PRODUCT_TIERS = {
  sample: { bags: 1, cogs: 6, label: '1-bag sample' },
  standard: { bags: 2, cogs: 12, label: '2-bag pack' },
  vip: { bags: 5, cogs: 30, label: '5-bag VIP box' },
};

export const DEFAULT_TIER = 'standard';

// ---------------------------------------------------------------------------
// Target hashtags — grouped by niche
// ---------------------------------------------------------------------------
export const TARGET_HASHTAGS = {
  americanMade: [
    'MadeInUSA', 'AmericanMade', 'BuyAmerican', 'MadeInAmerica',
    'USAMade', 'AmericanProducts', 'SupportLocal',
  ],
  cleanEating: [
    'CleanEating', 'DyeFree', 'NaturalFood', 'NoArtificialDyes',
    'CleanLabel', 'RealIngredients', 'NoJunk',
  ],
  candy: [
    'GummyBears', 'CandyReview', 'SnackReview', 'FoodReview',
    'CandyTok', 'SnackTime', 'TreatYourself',
  ],
  momLife: [
    'MomLife', 'CrunchyMom', 'MomBlogger', 'HealthyKids',
    'MomInfluencer', 'MomHack', 'ToddlerSnacks',
  ],
  fitness: [
    'FitLife', 'HealthySnacks', 'GymSnacks', 'MacroFriendly',
    'FitFood', 'GymLife', 'ProteinSnacks',
  ],
  patriotic: [
    'Patriotic', 'MilitaryLife', 'VeteranOwned', 'AmericaFirst',
    'ProudAmerican', 'MilSpouse', 'VeteranMade',
  ],
  homesteading: [
    'HomesteadLife', 'Prepper', 'SelfSufficient',
    'Homesteading', 'OffGrid', 'FarmLife',
  ],
};

// Flat list for quick iteration
export const ALL_HASHTAGS = Object.values(TARGET_HASHTAGS).flat();

// ---------------------------------------------------------------------------
// Discovery filters
// ---------------------------------------------------------------------------
export const DISCOVERY = {
  minFollowers: 1_000,
  maxFollowers: 50_000,
  minEngagementRate: 0.02,   // 2%
  maxDaysInactive: 30,       // must have posted in last 30 days
  languageFilter: 'en',
  countryFilter: 'US',       // best-effort
  platforms: ['instagram', 'tiktok', 'youtube'],
  resultsPerHashtag: 50,     // how many profiles to pull per hashtag
  deduplicateAcrossPlatforms: true,
};

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------
export const PIPELINE_STAGES = [
  { id: 'discovered',        label: 'Discovered',        color: '#94a3b8', order: 0 },
  { id: 'contacted',         label: 'Contacted',         color: '#3b82f6', order: 1 },
  { id: 'responded',         label: 'Responded',         color: '#8b5cf6', order: 2 },
  { id: 'product_sent',      label: 'Product Sent',      color: '#f59e0b', order: 3 },
  { id: 'posted',            label: 'Posted',            color: '#22c55e', order: 4 },
  { id: 'relationship_active', label: 'Relationship Active', color: '#14b8a6', order: 5 },
  { id: 'declined',          label: 'Declined',          color: '#ef4444', order: -1 },
  { id: 'unresponsive',      label: 'Unresponsive',      color: '#6b7280', order: -2 },
];

export const STAGE_IDS = PIPELINE_STAGES.map(s => s.id);

// ---------------------------------------------------------------------------
// Follow-up timing (days after previous action)
// ---------------------------------------------------------------------------
export const FOLLOWUP_TIMING = {
  noResponseNudge: 3,            // days after first contact
  confirmShipping: 0,            // immediately on positive response
  trackingNotification: 0,       // immediately on shipment
  deliveryCheckin: 7,            // days after estimated delivery
  thankYouAfterPost: 0,          // immediately on post detection
  softFollowupNoPost: 14,        // days after delivery if no post
  secondNudge: 7,                // days after first nudge if still no response
};

// ---------------------------------------------------------------------------
// Niche labels (for CRM tagging)
// ---------------------------------------------------------------------------
export const NICHE_LABELS = [
  'american-made',
  'clean-eating',
  'candy-review',
  'mom-life',
  'fitness',
  'patriotic',
  'homesteading',
  'food-review',
  'kids-snacks',
  'military',
  'prepper',
  'wellness',
  'other',
];

// ---------------------------------------------------------------------------
// Outreach template IDs
// ---------------------------------------------------------------------------
export const TEMPLATE_IDS = ['fan_first', 'mission_alignment', 'collaboration', 'exclusive_vip'];

// ---------------------------------------------------------------------------
// YouTube Data API (free tier: 10K queries/day)
// ---------------------------------------------------------------------------
export const YOUTUBE = {
  // Set via env var YOUTUBE_API_KEY or paste here
  apiKey: process.env.YOUTUBE_API_KEY || '',
};

// ---------------------------------------------------------------------------
// Reach estimation multipliers
// ---------------------------------------------------------------------------
export const REACH_ESTIMATES = {
  instagram: { reachRate: 0.20, engagementMultiplier: 1.0 },
  tiktok:    { reachRate: 0.35, engagementMultiplier: 1.5 },
  youtube:   { reachRate: 0.30, engagementMultiplier: 1.2 },
};

// ---------------------------------------------------------------------------
// FTC compliance
// ---------------------------------------------------------------------------
export const FTC = {
  requiredDisclosures: ['#gifted', '#ad', '#sponsored', '#usagummiespartner'],
  packingSlipDisclosureNote:
    'FTC Disclosure Reminder: If you share about this product on social media, ' +
    'please include #gifted or #ad in your post to comply with FTC guidelines. ' +
    'Thank you for keeping it transparent!',
};

export default {
  PATHS,
  BRAND,
  PRODUCT_TIERS,
  DEFAULT_TIER,
  TARGET_HASHTAGS,
  ALL_HASHTAGS,
  DISCOVERY,
  PIPELINE_STAGES,
  STAGE_IDS,
  FOLLOWUP_TIMING,
  NICHE_LABELS,
  TEMPLATE_IDS,
  YOUTUBE,
  REACH_ESTIMATES,
  FTC,
};
