// =============================================================================
// USA Gummies — Community Monitor Configuration
// =============================================================================

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------
export const PATHS = {
  dataDir: join(__dirname, 'data'),
  logsDir: join(__dirname, 'logs'),
  redditMatches: join(__dirname, 'data', 'reddit-matches.json'),
  generatedResponses: join(__dirname, 'data', 'generated-responses.json'),
  keywordReport: join(__dirname, 'data', 'keyword-report.json'),
  runLog: join(__dirname, 'logs', 'monitor.log'),
};

// ---------------------------------------------------------------------------
// Subreddits to monitor
// ---------------------------------------------------------------------------
export const SUBREDDITS = [
  'candy',
  'gummies',
  'snacks',
  'Supplements',
  'HealthyFood',
  'Parenting',
  'Mommit',
  'daddit',
  'BuyItForLife',
  'MadeinUSA',
  'food',
  'AskReddit',
  'ZeroWaste',
  'NaturalBeauty',
  // Added for dye-free news cycle (2025-2026)
  'news',
  'todayilearned',
  'mildlyinteresting',
  'nutrition',
  'FoodScience',
];

// ---------------------------------------------------------------------------
// Keywords to match (case-insensitive)
// ---------------------------------------------------------------------------
export const KEYWORDS = [
  'gummy bears',
  'gummies',
  'candy',
  'artificial dyes',
  'Red 40',
  'made in usa',
  'dye free',
  'dye-free',
  'natural candy',
  'kids snacks',
  'titanium dioxide',
  'food coloring',
  'American made',
  'patriotic snacks',
  'clean ingredients',
  'no artificial colors',
  'natural gummies',
  'organic gummy',
  'fruit snacks',
  'healthy candy',
  // Trending keywords — dye-free news cycle (2025-2026)
  'Red No. 3',
  'Red 3 ban',
  'Red 3',
  'food dye ban',
  'food dye',
  'synthetic dyes',
  'Mars dye free',
  'Skittles dye',
  'M&M dye',
  'make america healthy',
  'Yellow 5',
  'Yellow 6',
  'Blue 1',
  'food additive',
  'natural colors',
  'candy ingredients',
];

// ---------------------------------------------------------------------------
// Competitor brands to track alongside complaint keywords
// ---------------------------------------------------------------------------
export const COMPETITORS = [
  'Haribo',
  'Trolli',
  'Sour Patch Kids',
  'Skittles Gummies',
  'Nerds',
  'Black Forest',
  'Brach\'s',
  'Welch\'s Fruit Snacks',
];

export const COMPLAINT_KEYWORDS = [
  'artificial',
  'dyes',
  'chemicals',
  'made in china',
  'unhealthy',
  'ingredients',
  'cancer',
  'banned',
  'toxic',
  'Red 40',
  'Yellow 5',
  'Yellow 6',
  'Blue 1',
  'titanium dioxide',
];

// ---------------------------------------------------------------------------
// Persona definitions for response generation
// ---------------------------------------------------------------------------
export const PERSONAS = {
  helpful_parent: {
    name: 'Helpful Parent',
    slug: 'helpful_parent',
    description:
      'A parent who cares about what their kids eat. Focuses on clean ingredients, health, and finding better alternatives for children.',
    tone: 'warm, relatable, slightly concerned about kids\' health',
    exampleOpeners: [
      'As a mom of two picky eaters,',
      'We went through this exact thing when my daughter started reading labels,',
      'My pediatrician actually mentioned this last visit —',
      'I spent way too long in the candy aisle last week comparing labels,',
    ],
    guidelines: [
      'Reference personal parenting experiences',
      'Mention concern about what kids consume',
      'Talk about label reading and ingredient awareness',
      'Mention USA Gummies as something you personally found/switched to',
      'Never sound like a sales pitch',
    ],
  },

  patriotic_consumer: {
    name: 'Patriotic Consumer',
    slug: 'patriotic_consumer',
    description:
      'Someone who actively seeks out American-made products. Focuses on supporting domestic manufacturing and knowing where products come from.',
    tone: 'enthusiastic about American manufacturing, knowledgeable, conversational',
    exampleOpeners: [
      'I\'ve been on a buy-American kick for the last year and',
      'You\'d be surprised how hard it is to find candy actually made here —',
      'This is something I\'ve gotten really into researching lately.',
      'My rule is if I can find an American-made version, that\'s what I buy.',
    ],
    guidelines: [
      'Emphasize the difficulty of finding truly American-made candy',
      'Reference personal commitment to buying domestic',
      'Mention USA Gummies as a discovery in the buy-American journey',
      'Talk about supply chains and where things are actually manufactured',
      'Never be preachy — be genuinely excited about finding good options',
    ],
  },

  ingredient_nerd: {
    name: 'Ingredient Nerd',
    slug: 'ingredient_nerd',
    description:
      'Someone who reads every label and knows the science behind food ingredients. Focuses on specific chemicals, studies, and what to avoid.',
    tone: 'knowledgeable, slightly nerdy, matter-of-fact, not preachy',
    exampleOpeners: [
      'So I went down a rabbit hole on this —',
      'The research on this is actually pretty interesting.',
      'I used to not care about labels until I learned about',
      'Fun fact that will ruin your day:',
    ],
    guidelines: [
      'Reference specific ingredients by name (Red 40, titanium dioxide, etc.)',
      'Cite general knowledge about ingredient bans in other countries',
      'Be informative without being alarmist',
      'Mention USA Gummies as an example of a brand doing it right',
      'Sound like someone who genuinely enjoys learning about this stuff',
    ],
  },
};

// ---------------------------------------------------------------------------
// Response generation settings
// ---------------------------------------------------------------------------
export const RESPONSE_SETTINGS = {
  maxWords: 200,
  model: 'gpt-4.1-mini',
  temperature: 0.85,
  // Posts below this score are considered low-quality / not worth responding to
  minPostScore: 2,
  // Posts older than this many hours are skipped
  maxPostAgeHours: 48,
  // Brand rules
  brandName: 'USA Gummies',
  neverMention: ['Albanese', 'supplier', 'white label', 'wholesale'],
  neverUseLanguage: [
    'check out',
    'you should buy',
    'use my link',
    'discount code',
    'promo',
    'click here',
    'visit our',
    'our product',
    'we make',
    'we sell',
    'order now',
    'shop now',
    'limited time',
    'free shipping',
  ],
};

// ---------------------------------------------------------------------------
// Reddit API settings
// ---------------------------------------------------------------------------
export const REDDIT_SETTINGS = {
  // Public JSON API — use old.reddit.com to avoid 403s on www.reddit.com
  baseUrl: 'https://old.reddit.com',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Rate limit: be respectful — 2 seconds between requests
  requestDelayMs: 2000,
  // How many posts to fetch per subreddit (max 100)
  postsPerSubreddit: 50,
  // Sort: 'new' to get recent posts, 'hot' for trending
  sort: 'new',
};

// ---------------------------------------------------------------------------
// Keyword tracker settings
// ---------------------------------------------------------------------------
export const TRACKER_SETTINGS = {
  // Google Trends RSS feed base
  googleTrendsBase: 'https://trends.google.com/trending/rss',
  // How many days of history to consider
  lookbackDays: 7,
};
