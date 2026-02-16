// ============================================================================
// USA Gummies — Content Pipeline Configuration
// ============================================================================

export const BRAND = {
  name: 'USA Gummies',
  product: 'All American Gummy Bears',
  tagline: 'Made in America. No artificial junk.',
  website: 'https://usagummies.com',
  shopUrl: 'https://usagummies.com/shop',
  linkInBio: 'https://usagummies.com/go',
  tiktok: '@usagummies',
  instagram: '@usagummies',
  youtube: '@usagummies',
};

export const BRAND_CLAIMS = [
  'Made in the USA',
  'No artificial dyes',
  'All natural flavors',
  'No titanium dioxide',
  'No crushed insects (carmine)',
  'No trans fats',
  'No white mineral oil',
];

// All facts below are legally verifiable from product labels and public records.
export const COMPETITORS = {
  haribo: {
    name: 'Haribo',
    owner: 'Haribo (Germany)',
    hq: 'Bonn, Germany',
    madeIn: 'Goldbears in Pleasant Prairie, WI — most other products imported from Germany/Turkey/Brazil',
    issues: [
      'US version uses artificial colors; German version uses natural colorings (dual standard)',
      'Contains titanium dioxide (E171) — banned in EU food since 2022',
      'Red 40, Yellow 5, Yellow 6, Blue 1 in US products',
    ],
  },
  trolli: {
    name: 'Trolli',
    owner: 'Ferrara Candy / Ferrero Group (Italy)',
    hq: 'Luxembourg (Ferrero)',
    madeIn: 'Linares, Mexico',
    issues: [
      'Contains titanium dioxide',
      'Red 40, Yellow 5, Yellow 6, Blue 1',
      'Owned by Italian conglomerate, made in Mexico',
    ],
  },
  sourPatchKids: {
    name: 'Sour Patch Kids',
    owner: 'Mondelez International',
    hq: 'Chicago, IL (Mondelez)',
    madeIn: 'Hamilton, Ontario, Canada and Monterrey, Mexico',
    issues: [
      'Red 40, Yellow 5, Yellow 6, Blue 1',
      'Watermelon variety contains titanium dioxide',
      'Swedish Fish (same brand family) contains white mineral oil',
      'Not made in America despite American branding',
    ],
  },
  skittlesGummies: {
    name: 'Skittles Gummies',
    owner: 'Mars, Inc.',
    hq: 'McLean, VA (Mars)',
    madeIn: 'Various',
    issues: [
      'Red 40, Yellow 5, Yellow 6, Blue 1',
      'Bite-size contains titanium dioxide',
      'Mars promised to remove artificial colors in 2016 — still has not',
    ],
  },
  nerdsGummyClusters: {
    name: 'Nerds Gummy Clusters',
    owner: 'Ferrara Candy / Ferrero Group (Italy)',
    hq: 'Luxembourg (Ferrero)',
    madeIn: 'Mexico',
    issues: [
      '8 artificial dyes in one product',
      'Contains carmine (crushed cochineal insects) for red coloring',
      'Owned by Italian conglomerate, manufactured in Mexico',
    ],
  },
  brachs: {
    name: "Brach's",
    owner: 'Ferrara Candy / Ferrero Group (Italy)',
    hq: 'Luxembourg (Ferrero)',
    madeIn: 'Various',
    issues: [
      'Red 40, Yellow 5, Blue 1',
      'Owned by Italian conglomerate',
    ],
  },
  airheads: {
    name: 'Airheads',
    owner: 'Perfetti Van Melle (Netherlands/Italy)',
    hq: 'Amsterdam, Netherlands',
    madeIn: 'Various',
    issues: [
      'Contains partially hydrogenated soybean oil (trans fat)',
      'Owned by Dutch-Italian conglomerate',
    ],
  },
};

export const CATEGORIES = {
  INGREDIENT_EXPOSE: {
    id: 'ingredient-expose',
    name: 'Ingredient Expose',
    description: 'Reveal what is actually in competitor candy — read labels, show ingredients, expose dual standards.',
    emoji: null,
    bestDays: ['tuesday', 'wednesday', 'thursday'],
    bestTime: 'evening',
  },
  MADE_IN_USA: {
    id: 'made-in-usa',
    name: 'Made in USA Patriotic',
    description: 'American pride, support domestic manufacturing, buy American.',
    emoji: null,
    bestDays: ['monday', 'friday', 'saturday'],
    bestTime: 'morning',
  },
  PARENT_HEALTH: {
    id: 'parent-health',
    name: 'Parent / Health Angle',
    description: 'Clean ingredients for kids, dye-free living, parenting moments.',
    emoji: null,
    bestDays: ['monday', 'tuesday', 'wednesday'],
    bestTime: 'morning',
  },
  COMPARISON: {
    id: 'comparison',
    name: 'Comparison / Switch',
    description: 'Direct product comparisons, side by side, taste tests, switching stories.',
    emoji: null,
    bestDays: ['wednesday', 'thursday', 'friday'],
    bestTime: 'evening',
  },
  TRENDING: {
    id: 'trending',
    name: 'Trending / Reactive',
    description: 'Hook into current events, news about food ingredients, FDA actions, state bans.',
    emoji: null,
    bestDays: ['any'],
    bestTime: 'asap',
  },
  STORYTELLING: {
    id: 'storytelling',
    name: 'Storytelling / Brand',
    description: 'Origin story, founder journey, behind the scenes, brand building.',
    emoji: null,
    bestDays: ['saturday', 'sunday'],
    bestTime: 'morning',
  },
};

export const PLATFORMS = {
  tiktok: {
    name: 'TikTok',
    maxDuration: 60,
    idealDuration: [15, 30],
    aspectRatio: '9:16',
    notes: 'Hook in first 1-2 seconds. Trending sounds help. Green screen format works well for expose content. Text-on-screen is critical — most viewers watch muted.',
  },
  reels: {
    name: 'Instagram Reels',
    maxDuration: 90,
    idealDuration: [15, 30],
    aspectRatio: '9:16',
    notes: 'Slightly more polished than TikTok. Carousel Reels option for comparison content. Cover image matters for profile grid. Use 3-5 hashtags max in caption.',
  },
  shorts: {
    name: 'YouTube Shorts',
    maxDuration: 60,
    idealDuration: [30, 60],
    aspectRatio: '9:16',
    notes: 'Can be slightly longer and more informative than TikTok. Title and thumbnail matter. Searchable — use keywords. Shorts feed is discovery-heavy.',
  },
  pinterest: {
    name: 'Pinterest Video Pin',
    maxDuration: 60,
    idealDuration: [15, 30],
    aspectRatio: '9:16',
    notes: 'Thumbnail-first platform. Text overlay heavy. Evergreen content performs best. SEO-driven titles. Link directly to product page.',
  },
  twitter: {
    name: 'Twitter / X',
    maxDuration: 140,
    idealDuration: [30, 60],
    aspectRatio: '16:9',
    notes: 'Video optional — text + image works. Thread format for deep dives. Quote-tweet competitor news. Engagement bait works.',
  },
  facebook: {
    name: 'Facebook',
    maxDuration: 240,
    idealDuration: [60, 120],
    aspectRatio: '1:1',
    notes: 'Longer form OK. Shareable content performs best. Parent groups are prime audience. Square format preferred in feed.',
  },
};

export const POSTING_SCHEDULE = {
  postsPerDay: 2,
  slots: {
    morning: { hour: 8, label: '8:00 AM ET' },
    evening: { hour: 18, label: '6:00 PM ET' },
  },
  timezone: 'America/New_York',
};

export const CTA_OPTIONS = [
  'Link in bio — USA Gummies, made in America.',
  'USA Gummies. Made in America. No artificial junk. Link in bio.',
  'Try them yourself — link in bio.',
  'Would you switch? Link in bio.',
  'USA Gummies dot com. That is all.',
  'Check the link in bio before your next grocery run.',
  'Follow for more ingredient breakdowns.',
  'Save this for your next Target run.',
  'Comment "LABEL" and I will send you the full ingredient comparison.',
  'Follow if you care what is in your food.',
];

export const OUTPUT_DIR = new URL('./output/', import.meta.url).pathname;
export const TEMPLATES_DIR = new URL('./templates/', import.meta.url).pathname;
