#!/usr/bin/env node
// ============================================================================
// USA Gummies — Hashtag Strategy Database
// Curated, categorized hashtag sets for short-form video content
//
// Usage:
//   node hashtags.mjs                    # print full reference sheet
//   node hashtags.mjs --category <id>    # hashtags for a specific category
//   node hashtags.mjs --export           # write reference files to output/
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, OUTPUT_DIR } from './config.mjs';

// ---------------------------------------------------------------------------
// Core Brand Hashtags (use on every post)
// ---------------------------------------------------------------------------
export const BRAND_HASHTAGS = [
  '#USAGummies',
  '#MadeInUSACandy',
  '#AmericanGummies',
  '#AllAmericanGummyBears',
];

// ---------------------------------------------------------------------------
// Category-Specific Hashtags
// ---------------------------------------------------------------------------
export const CATEGORY_HASHTAGS = {
  [CATEGORIES.INGREDIENT_EXPOSE.id]: {
    primary: [
      '#DyeFreeCandy',
      '#ReadTheLabel',
      '#FoodIngredients',
      '#TitaniumDioxideInFood',
      '#Red40',
      '#ArtificialDyes',
      '#FoodDyes',
      '#IngredientCheck',
      '#WhatIsInYourFood',
      '#CleanIngredients',
    ],
    secondary: [
      '#FoodSafety',
      '#LabelReader',
      '#FoodTransparency',
      '#HiddenIngredients',
      '#ChemicalsInFood',
      '#BannedInEurope',
      '#FoodAwareness',
    ],
  },
  [CATEGORIES.MADE_IN_USA.id]: {
    primary: [
      '#MadeInAmerica',
      '#MadeInUSA',
      '#BuyAmerican',
      '#AmericanMade',
      '#SupportAmerican',
      '#PatrioticSnacks',
      '#AmericanCandy',
      '#USAMade',
      '#AmericanManufacturing',
      '#BuyLocal',
    ],
    secondary: [
      '#AmericanBusiness',
      '#SmallBusinessUSA',
      '#AmericanJobs',
      '#DomesticManufacturing',
      '#AmericaFirst',
      '#SupportSmallBusiness',
      '#ProudlyAmerican',
    ],
  },
  [CATEGORIES.PARENT_HEALTH.id]: {
    primary: [
      '#DyeFreeLiving',
      '#DyeFreeKids',
      '#CleanEatingKids',
      '#MomLife',
      '#DadLife',
      '#HealthyKids',
      '#ParentingTips',
      '#LunchboxIdeas',
      '#HealthySnacks',
      '#NoArtificialDyes',
    ],
    secondary: [
      '#MomTok',
      '#CrunchyMom',
      '#HealthyParenting',
      '#KidSnacks',
      '#SchoolLunch',
      '#CleanLabel',
      '#NaturalCandy',
      '#HealthyCandy',
      '#ParentHack',
    ],
  },
  [CATEGORIES.COMPARISON.id]: {
    primary: [
      '#CandyComparison',
      '#TasteTest',
      '#SideBySide',
      '#GummyBearReview',
      '#CandyReview',
      '#HonestReview',
      '#TheSwitchUp',
      '#BetterAlternative',
      '#CandySwap',
      '#IngredientComparison',
    ],
    secondary: [
      '#FoodReview',
      '#SnackReview',
      '#BlindTasteTest',
      '#ProductReview',
      '#TierList',
      '#Ranking',
      '#GummyBears',
    ],
  },
  [CATEGORIES.TRENDING.id]: {
    primary: [
      '#FoodNews',
      '#FDANews',
      '#FoodSafety',
      '#BreakingNews',
      '#HealthNews',
      '#FoodRecall',
      '#FoodPolicy',
      '#Red40Ban',
      '#DyeBan',
      '#FoodRegulation',
    ],
    secondary: [
      '#ConsumerAwareness',
      '#KnowYourFood',
      '#FoodIndustry',
      '#HealthAlert',
      '#FoodUpdate',
      '#StayInformed',
    ],
  },
  [CATEGORIES.STORYTELLING.id]: {
    primary: [
      '#FounderStory',
      '#SmallBusiness',
      '#Entrepreneur',
      '#StartupLife',
      '#BuildInPublic',
      '#SmallBusinessOwner',
      '#BrandStory',
      '#BehindTheScenes',
      '#DayInTheLife',
      '#SmallBrandBigDreams',
    ],
    secondary: [
      '#EntrepreneurLife',
      '#StartupJourney',
      '#Hustle',
      '#SmallBusinessLife',
      '#FounderLife',
      '#UnderDog',
      '#BusinessOwner',
    ],
  },
};

// ---------------------------------------------------------------------------
// Competitor Comparison Hashtags
// ---------------------------------------------------------------------------
export const COMPETITOR_HASHTAGS = {
  haribo: ['#Haribo', '#HariboGoldbears', '#GummyBears', '#HariboVs'],
  trolli: ['#Trolli', '#TrolliGummies', '#SourGummy'],
  sourPatchKids: ['#SourPatchKids', '#SPK', '#SourCandy'],
  skittlesGummies: ['#Skittles', '#SkittlesGummies', '#Mars'],
  nerdsGummyClusters: ['#Nerds', '#NerdsGummyClusters', '#NerdsCandy'],
  brachs: ['#Brachs', '#BrachsCandy'],
  airheads: ['#Airheads', '#AirheadsCandy'],
};

// ---------------------------------------------------------------------------
// Seasonal / Event Hashtags
// ---------------------------------------------------------------------------
export const SEASONAL_HASHTAGS = {
  newYears: {
    dates: 'Dec 28 - Jan 7',
    tags: ['#NewYear', '#NewYearNewMe', '#HealthyNewYear', '#2026Goals', '#FreshStart'],
  },
  valentines: {
    dates: 'Feb 1 - Feb 14',
    tags: ['#ValentinesDay', '#ValentineCandy', '#GiftIdeas', '#SweetTreats'],
  },
  presidentsDay: {
    dates: 'Feb 14 - Feb 18',
    tags: ['#PresidentsDay', '#AmericanPride', '#MadeInAmerica'],
  },
  easter: {
    dates: 'Mar 15 - Apr 15 (varies)',
    tags: ['#Easter', '#EasterCandy', '#EasterBasket', '#EasterTreats', '#SpringCandy'],
  },
  memorialDay: {
    dates: 'May 20 - May 28',
    tags: ['#MemorialDay', '#HonorOurHeroes', '#AmericanPride', '#SummerKickoff'],
  },
  july4th: {
    dates: 'Jun 25 - Jul 7',
    tags: ['#4thOfJuly', '#IndependenceDay', '#FourthOfJuly', '#Fireworks', '#America', '#Patriotic', '#RedWhiteAndBlue'],
  },
  laborDay: {
    dates: 'Aug 28 - Sep 5',
    tags: ['#LaborDay', '#AmericanWorkers', '#LaborDayWeekend', '#EndOfSummer'],
  },
  backToSchool: {
    dates: 'Aug 1 - Sep 15',
    tags: ['#BackToSchool', '#SchoolSnacks', '#Lunchbox', '#SchoolLunch', '#BTS'],
  },
  halloween: {
    dates: 'Oct 1 - Nov 1',
    tags: ['#Halloween', '#HalloweenCandy', '#TrickOrTreat', '#HalloweenTreats', '#SpookySeason'],
  },
  thanksgiving: {
    dates: 'Nov 15 - Nov 28',
    tags: ['#Thanksgiving', '#Grateful', '#ThankfulFor', '#FamilyTime'],
  },
  christmas: {
    dates: 'Nov 25 - Dec 26',
    tags: ['#Christmas', '#ChristmasCandy', '#StockingStuffers', '#HolidayTreats', '#GiftIdeas'],
  },
  summer: {
    dates: 'Jun 1 - Aug 31',
    tags: ['#Summer', '#SummerSnacks', '#PoolDay', '#BBQ', '#SummerVibes'],
  },
};

// ---------------------------------------------------------------------------
// Community Hashtags (audience groups)
// ---------------------------------------------------------------------------
export const COMMUNITY_HASHTAGS = {
  momTok: ['#MomTok', '#MomLife', '#MomHack', '#MomOfBoys', '#MomOfGirls', '#SahMom', '#WorkingMom'],
  dadTok: ['#DadTok', '#DadLife', '#DadHack', '#GirlDad', '#BoyDad'],
  cleanEating: ['#CleanEating', '#CleanLabel', '#RealFood', '#WholeFoods', '#NoJunk', '#EatClean'],
  patriotic: ['#America', '#USA', '#Patriot', '#AmericaFirst', '#ProudAmerican'],
  foodie: ['#Foodie', '#FoodTok', '#SnackTok', '#CandyTok', '#FoodReview', '#SnackReview'],
  health: ['#HealthTok', '#HealthyLiving', '#Wellness', '#HealthyEating'],
};

// ---------------------------------------------------------------------------
// Trending Sound/Format Hashtags (update monthly)
// ---------------------------------------------------------------------------
export const TRENDING_TEMPLATES = [
  '#[Sound Name]',
  '#TikTokMadeMeBuyIt',
  '#GroceryTok',
  '#TargetRun',
  '#TargetFinds',
  '#WalmartFinds',
  '#AmazonFinds',
  '#ThingsYouDidntKnow',
  '#TheMoreYouKnow',
  '#DidYouKnow',
  '#LearnOnTikTok',
  '#FYP',
  '#ForYouPage',
  '#Viral',
];

// ---------------------------------------------------------------------------
// Get hashtags for a specific category (used by generate-scripts.mjs)
// ---------------------------------------------------------------------------
export function getHashtagsForCategory(categoryId, options = {}) {
  const { includeCompetitor = null, maxTags = 10 } = options;

  const tags = [...BRAND_HASHTAGS];

  const catTags = CATEGORY_HASHTAGS[categoryId];
  if (catTags) {
    // Take first several primary tags
    const primaryCount = Math.min(4, catTags.primary.length);
    tags.push(...catTags.primary.slice(0, primaryCount));
    // One or two secondary
    tags.push(...catTags.secondary.slice(0, 2));
  }

  if (includeCompetitor && COMPETITOR_HASHTAGS[includeCompetitor]) {
    tags.push(...COMPETITOR_HASHTAGS[includeCompetitor].slice(0, 2));
  }

  // Add a trending template
  tags.push('#FYP');

  return tags.slice(0, maxTags);
}

// ---------------------------------------------------------------------------
// Generate reference sheet
// ---------------------------------------------------------------------------
function generateReferenceSheet() {
  const lines = [];
  lines.push('# USA Gummies — Hashtag Strategy Reference');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Core Brand Hashtags (use on EVERY post)');
  lines.push('');
  lines.push(BRAND_HASHTAGS.join(' '));
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Category-Specific Hashtags');
  lines.push('');
  for (const [catId, tags] of Object.entries(CATEGORY_HASHTAGS)) {
    const catMeta = Object.values(CATEGORIES).find((c) => c.id === catId);
    lines.push(`### ${catMeta ? catMeta.name : catId}`);
    lines.push('');
    lines.push('**Primary:**');
    lines.push(tags.primary.join(' '));
    lines.push('');
    lines.push('**Secondary:**');
    lines.push(tags.secondary.join(' '));
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  lines.push('## Competitor Hashtags');
  lines.push('');
  for (const [comp, tags] of Object.entries(COMPETITOR_HASHTAGS)) {
    lines.push(`**${comp}:** ${tags.join(' ')}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  lines.push('## Seasonal / Event Hashtags');
  lines.push('');
  for (const [event, data] of Object.entries(SEASONAL_HASHTAGS)) {
    lines.push(`**${event}** (${data.dates}):`);
    lines.push(data.tags.join(' '));
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  lines.push('## Community Hashtags');
  lines.push('');
  for (const [group, tags] of Object.entries(COMMUNITY_HASHTAGS)) {
    lines.push(`**${group}:** ${tags.join(' ')}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  lines.push('## Trending / Evergreen Templates');
  lines.push('');
  lines.push(TRENDING_TEMPLATES.join(' '));
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Best Practices');
  lines.push('');
  lines.push('- **TikTok:** 3-5 hashtags. Mix niche + broad. Include at least 1 trending.');
  lines.push('- **Instagram Reels:** 3-5 hashtags in caption. Do not overload — Instagram penalizes spam.');
  lines.push('- **YouTube Shorts:** Hashtags go in title and description. Max 3 in title. Use keywords.');
  lines.push('- **Pinterest:** Use as keywords in pin title and description. SEO-driven, not trend-driven.');
  lines.push('- **Always include:** At least 1 brand hashtag + 1 category hashtag + 1 community hashtag.');
  lines.push('- **Rotate:** Do not use the exact same set every post. Vary within the category pool.');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const categoryArg = args.indexOf('--category') !== -1 ? args[args.indexOf('--category') + 1] : null;
  const exportMode = args.includes('--export');

  if (categoryArg) {
    const tags = getHashtagsForCategory(categoryArg);
    console.log(`Hashtags for ${categoryArg}:`);
    console.log(tags.join(' '));
    return;
  }

  const sheet = generateReferenceSheet();

  if (exportMode) {
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const mdPath = join(OUTPUT_DIR, 'hashtag-reference.md');
    writeFileSync(mdPath, sheet, 'utf-8');
    console.log(`Reference sheet: ${mdPath}`);

    // Also export as JSON
    const jsonData = {
      brand: BRAND_HASHTAGS,
      category: CATEGORY_HASHTAGS,
      competitor: COMPETITOR_HASHTAGS,
      seasonal: SEASONAL_HASHTAGS,
      community: COMMUNITY_HASHTAGS,
      trending: TRENDING_TEMPLATES,
      generatedAt: new Date().toISOString(),
    };
    const jsonPath = join(OUTPUT_DIR, 'hashtag-reference.json');
    writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log(`JSON data:       ${jsonPath}`);
  } else {
    console.log(sheet);
  }
}

main();
