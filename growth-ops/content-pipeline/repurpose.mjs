#!/usr/bin/env node
// ============================================================================
// USA Gummies — Repurpose Matrix
// Takes one video script and generates platform-specific versions for:
// TikTok, Instagram Reels, YouTube Shorts, Pinterest, Twitter/X, Facebook
//
// Usage:
//   node repurpose.mjs --id expose-002
//   node repurpose.mjs --title "8 Artificial Dyes"
//   node repurpose.mjs --random
//   node repurpose.mjs --all                  # repurpose every script
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS_DB } from './scripts-db.mjs';
import { BRAND, PLATFORMS, CATEGORIES, CTA_OPTIONS, OUTPUT_DIR } from './config.mjs';
import { getHashtagsForCategory, BRAND_HASHTAGS, COMMUNITY_HASHTAGS, TRENDING_TEMPLATES } from './hashtags.mjs';

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(flag) { return args.includes(flag); }

const scriptId = getArg('--id');
const titleSearch = getArg('--title');
const randomMode = hasFlag('--random');
const allMode = hasFlag('--all');

// ---------------------------------------------------------------------------
// Find Script(s)
// ---------------------------------------------------------------------------
function findScripts() {
  if (allMode) return SCRIPTS_DB;

  if (scriptId) {
    const found = SCRIPTS_DB.filter((s) => s.id === scriptId);
    if (found.length === 0) {
      console.error(`No script found with ID: ${scriptId}`);
      process.exit(1);
    }
    return found;
  }

  if (titleSearch) {
    const lower = titleSearch.toLowerCase();
    const found = SCRIPTS_DB.filter((s) => s.title.toLowerCase().includes(lower));
    if (found.length === 0) {
      console.error(`No script found matching title: "${titleSearch}"`);
      process.exit(1);
    }
    return found;
  }

  if (randomMode) {
    const idx = Math.floor(Math.random() * SCRIPTS_DB.length);
    return [SCRIPTS_DB[idx]];
  }

  console.error('Specify --id, --title, --random, or --all');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Platform Adapters
// ---------------------------------------------------------------------------

function adaptTikTok(script) {
  const hashtags = getHashtagsForCategory(script.category, { maxTags: 5 });
  hashtags.push('#FYP', '#TikTokMadeMeBuyIt');

  return {
    platform: 'TikTok',
    format: 'Vertical video (9:16)',
    duration: `${Math.min(script.estimatedDuration, 60)}s (max 60s)`,
    hook: script.hook,
    body: [
      'PACING: Fast cuts, 2-3 second clips max. Do not let any single shot linger.',
      'SOUND: Use a trending sound if relevant, otherwise original audio with captions.',
      'TEXT: Large, bold text on screen for every key point. Most viewers watch muted.',
      'FORMAT OPTIONS:',
      '  - Green screen (you + product/label behind you)',
      '  - POV/duet format (react to competitor content)',
      '  - Storytime with B-roll overlay',
      '',
      'SCRIPT BEATS:',
      ...script.body.map((line, i) => `  ${i + 1}. ${line}`),
    ],
    cta: script.cta,
    caption: `${script.hook.slice(0, 100)}... ${hashtags.slice(0, 5).join(' ')}`,
    hashtags: hashtags.slice(0, 7),
    notes: [
      'Post between 7-9 AM ET or 5-7 PM ET for best reach.',
      'First frame matters — use a pattern interrupt or shocking text.',
      'Reply to comments with video responses to boost engagement.',
      'Save trending sounds from FYP and match them to scripts.',
    ],
  };
}

function adaptReels(script) {
  const hashtags = getHashtagsForCategory(script.category, { maxTags: 5 });

  return {
    platform: 'Instagram Reels',
    format: 'Vertical video (9:16)',
    duration: `${Math.min(script.estimatedDuration, 90)}s (max 90s)`,
    hook: script.hook,
    body: [
      'PACING: Slightly more polished than TikTok. Clean transitions.',
      'AESTHETIC: Consistent color grading. Match the brand (warm, clean tones).',
      'COVER IMAGE: Design a custom cover for the profile grid — text overlay on product shot.',
      'CAPTIONS: Built-in Instagram captions. Clean, readable font.',
      'FORMAT OPTIONS:',
      '  - Standard Reel with text overlays',
      '  - Carousel Reel (for comparisons — each slide = one competitor)',
      '  - Collab Reel (tag a creator for reach)',
      '',
      'SCRIPT BEATS:',
      ...script.body.map((line, i) => `  ${i + 1}. ${line}`),
    ],
    cta: script.cta,
    caption: buildInstagramCaption(script),
    hashtags: hashtags.slice(0, 5),
    notes: [
      'Post between 8-10 AM ET or 6-8 PM ET.',
      'Use 3-5 hashtags max — Instagram deprioritizes hashtag spam.',
      'Share Reel to Stories with a "Watch Full Reel" sticker for 2x reach.',
      'Cover image should be readable as a thumbnail on the profile grid.',
      'Carousel Reels get 2x the watch time — use for comparison content.',
    ],
  };
}

function adaptShorts(script) {
  const hashtags = getHashtagsForCategory(script.category, { maxTags: 4 });

  return {
    platform: 'YouTube Shorts',
    format: 'Vertical video (9:16)',
    duration: `${Math.min(script.estimatedDuration + 10, 60)}s (max 60s, can be slightly longer)`,
    hook: script.hook,
    body: [
      'PACING: Can be slightly slower than TikTok. More informative, educational.',
      'DEPTH: YouTube audience expects more substance. Add one extra fact or detail.',
      'TITLE: Keyword-rich title for search (Shorts are indexed and searchable).',
      'THUMBNAIL: Not selectable for Shorts, but first frame matters.',
      '',
      'EXPANDED SCRIPT (add depth):',
      ...script.body.map((line, i) => `  ${i + 1}. ${line}`),
      '',
      'BONUS DETAIL:',
      '  Add one extra fact, stat, or "wait, it gets worse" moment that TikTok version cuts.',
    ],
    cta: `${script.cta} Subscribe for more ingredient breakdowns.`,
    title: buildYouTubeTitle(script),
    description: buildYouTubeDescription(script, hashtags),
    hashtags: hashtags.slice(0, 3),
    notes: [
      'Post between 9-11 AM ET or 7-9 PM ET.',
      'Title is critical — use keywords people search for.',
      'Shorts feed is discovery-driven. Evergreen content performs well over time.',
      'Add a pinned comment with the link to USA Gummies.',
      'End with a verbal CTA: "Subscribe for more ingredient breakdowns."',
    ],
  };
}

function adaptPinterest(script) {
  return {
    platform: 'Pinterest Video Pin',
    format: 'Vertical video (9:16) or static image pin',
    duration: `${Math.min(script.estimatedDuration, 60)}s`,
    hook: script.hook,
    body: [
      'THUMBNAIL: This is a thumbnail-first platform. The cover image determines performance.',
      'TEXT OVERLAY: Heavy text on every frame. Pinterest users skim.',
      'SEO: Title and description must contain keywords people search for.',
      'EVERGREEN: Pinterest content has a 3-6 month lifespan — focus on timeless topics.',
      'LINK: Pin directly to the product page (usagummies.com/shop).',
      '',
      'VIDEO ADAPTATION:',
      '  - Same core content but with more text overlays',
      '  - Each key point gets a full-screen text card',
      '  - Slower pacing — users do not expect TikTok speed here',
      '',
      'ALTERNATIVE: Convert to a static pin with list format:',
      ...script.onScreenText.map((t) => `  - ${t}`),
    ],
    cta: 'Shop USA Gummies — link on pin.',
    pinTitle: buildPinterestTitle(script),
    pinDescription: buildPinterestDescription(script),
    notes: [
      'Pin to relevant boards: "Clean Eating", "Made in USA", "Healthy Snacks for Kids".',
      'Pinterest is a search engine — optimize for keywords, not trends.',
      'Video Pins autoplay in feed — first 2 seconds must grab attention.',
      'Add product link to every pin.',
      'Create 3-5 variations of the same content for testing.',
    ],
  };
}

function adaptTwitter(script) {
  const hashtags = getHashtagsForCategory(script.category, { maxTags: 3 });

  const tweetThread = buildTwitterThread(script);

  return {
    platform: 'Twitter / X',
    format: 'Text post + image, or short video (16:9), or thread',
    duration: 'N/A (text-first)',
    hook: script.hook,
    body: [
      'FORMAT OPTIONS:',
      '  1. Single tweet + image of ingredient labels',
      '  2. Thread (4-6 tweets) with image per tweet',
      '  3. Quote-tweet a competitor or news story with your take',
      '  4. Short video clip (recut from vertical for 16:9)',
      '',
      'ENGAGEMENT TACTICS:',
      '  - Ask a question to drive replies',
      '  - "RT if you check candy labels"',
      '  - Tag relevant accounts (food safety orgs, parent accounts)',
    ],
    cta: 'USA Gummies. Made in America. No artificial junk.',
    singleTweet: buildSingleTweet(script, hashtags),
    thread: tweetThread,
    hashtags: hashtags.slice(0, 3),
    notes: [
      'Twitter/X is text-first. Lead with the most shocking fact.',
      'Images of ingredient labels perform extremely well.',
      'Threads get more impressions than single tweets for educational content.',
      'Quote-tweet competitor news or viral food content.',
      'Engagement rate matters more than follower count.',
    ],
  };
}

function adaptFacebook(script) {
  return {
    platform: 'Facebook',
    format: 'Video (1:1 square or 16:9) + long-form caption, or text post with image',
    duration: `${script.estimatedDuration + 30}s (can be longer on FB)`,
    hook: script.hook,
    body: [
      'AUDIENCE: Parents, 30-55. Health-conscious. Share-driven.',
      'FORMAT: Square video (1:1) performs best in feed. Longer captions OK.',
      'SHARING: Optimize for shares — "Tag a parent who needs to see this."',
      'GROUPS: Cross-post to relevant Facebook Groups:',
      '  - Parent groups (moms, dads, homeschool)',
      '  - Clean eating / health groups',
      '  - Made in USA / buy American groups',
      '  - Local community groups',
      '',
      'EXPANDED SCRIPT:',
      ...script.body.map((line, i) => `  ${i + 1}. ${line}`),
      '',
      'ADDITIONAL CONTEXT:',
      '  Facebook audience wants more detail than TikTok. Add backstory.',
      '  Include a personal anecdote or extended explanation.',
    ],
    cta: script.cta,
    caption: buildFacebookCaption(script),
    notes: [
      'Facebook rewards watch time — slightly longer videos perform well.',
      'Square (1:1) format takes up more screen real estate in the feed.',
      'Shareability is the #1 metric. "Tag someone" CTAs work.',
      'Cross-post to 3-5 relevant groups with tailored intro text.',
      'Facebook Reels also exist — post the vertical version there too.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Caption / Copy Builders
// ---------------------------------------------------------------------------

function buildInstagramCaption(script) {
  const catMeta = Object.values(CATEGORIES).find((c) => c.id === script.category);
  const hashtags = getHashtagsForCategory(script.category, { maxTags: 5 });

  return [
    script.hook,
    '',
    script.body.slice(0, 3).map((l) => l.replace(/^"/, '').replace(/"$/, '')).join(' '),
    '',
    script.cta,
    '',
    hashtags.join(' '),
  ].join('\n');
}

function buildYouTubeTitle(script) {
  // Keyword-rich, searchable, under 100 chars
  const titles = {
    'ingredient-expose': `What is ACTUALLY in ${script.competitor ? script.competitor.charAt(0).toUpperCase() + script.competitor.slice(1) : 'Your Candy'}? Ingredient Breakdown`,
    'made-in-usa': `Is Your Candy REALLY Made in America? | USA Gummies`,
    'parent-health': `Artificial Dyes in Kids Candy — What Parents Need to Know`,
    'comparison': `${script.title} | Honest Comparison`,
    'trending': script.hook.slice(0, 80),
    'storytelling': script.hook.slice(0, 80),
  };

  return titles[script.category] || script.title;
}

function buildYouTubeDescription(script, hashtags) {
  return [
    script.hook,
    '',
    'In this video, I break down the ingredients in popular candy and show you what to look for on the label.',
    '',
    `Try USA Gummies: ${BRAND.linkInBio}`,
    '',
    'Made in America. No artificial dyes. All natural flavors.',
    '',
    hashtags.join(' '),
  ].join('\n');
}

function buildPinterestTitle(script) {
  const templates = {
    'ingredient-expose': `What You Need to Know About Candy Ingredients | ${script.title}`,
    'made-in-usa': `American-Made Candy | ${script.title}`,
    'parent-health': `Dye-Free Candy for Kids | ${script.title}`,
    'comparison': `Candy Comparison | ${script.title}`,
    'trending': script.title,
    'storytelling': script.title,
  };
  return templates[script.category] || script.title;
}

function buildPinterestDescription(script) {
  return [
    script.hook,
    '',
    script.body.slice(0, 2).join(' ').replace(/"/g, ''),
    '',
    `Shop USA Gummies at ${BRAND.website} — Made in America, no artificial dyes, all natural flavors.`,
    '',
    '#MadeInUSA #DyeFreeCandy #CleanEating #HealthySnacks #USAGummies',
  ].join('\n');
}

function buildSingleTweet(script, hashtags) {
  // Under 280 chars
  const hook = script.hook.length > 200 ? script.hook.slice(0, 197) + '...' : script.hook;
  const tagStr = hashtags.slice(0, 2).join(' ');
  const tweet = `${hook}\n\n${BRAND.linkInBio}\n\n${tagStr}`;
  return tweet.slice(0, 280);
}

function buildTwitterThread(script) {
  const tweets = [];

  // Tweet 1: Hook
  tweets.push(`1/ ${script.hook}`);

  // Tweet 2-4: Key points from body
  const bodyChunks = [];
  let chunk = '';
  for (const line of script.body) {
    const cleaned = line.replace(/^"/, '').replace(/"$/, '');
    if ((chunk + ' ' + cleaned).length > 250) {
      bodyChunks.push(chunk.trim());
      chunk = cleaned;
    } else {
      chunk += ' ' + cleaned;
    }
  }
  if (chunk.trim()) bodyChunks.push(chunk.trim());

  bodyChunks.slice(0, 3).forEach((c, i) => {
    tweets.push(`${i + 2}/ ${c}`);
  });

  // Final tweet: CTA
  tweets.push(`${tweets.length + 1}/ ${script.cta}\n\n${BRAND.linkInBio}`);

  return tweets;
}

function buildFacebookCaption(script) {
  return [
    script.hook,
    '',
    ...script.body.map((l) => l.replace(/^"/, '').replace(/"$/, '')),
    '',
    script.cta,
    '',
    `${BRAND.website}`,
    '',
    'Tag a parent who needs to see this.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generate Repurpose Document
// ---------------------------------------------------------------------------
function repurposeScript(script) {
  const versions = {
    original: script,
    tiktok: adaptTikTok(script),
    reels: adaptReels(script),
    shorts: adaptShorts(script),
    pinterest: adaptPinterest(script),
    twitter: adaptTwitter(script),
    facebook: adaptFacebook(script),
  };

  return versions;
}

function repurposeToMarkdown(versions) {
  const script = versions.original;
  const lines = [];

  lines.push(`# Repurpose Matrix: ${script.title}`);
  lines.push('');
  lines.push(`**Script ID:** \`${script.id}\``);
  lines.push(`**Category:** ${script.category}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Original script summary
  lines.push('## Original Script');
  lines.push('');
  lines.push(`**Hook:** ${script.hook}`);
  lines.push(`**Duration:** ~${script.estimatedDuration}s`);
  lines.push(`**CTA:** ${script.cta}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Each platform version
  for (const key of ['tiktok', 'reels', 'shorts', 'pinterest', 'twitter', 'facebook']) {
    const v = versions[key];
    lines.push(`## ${v.platform}`);
    lines.push('');
    lines.push(`**Format:** ${v.format}`);
    lines.push(`**Duration:** ${v.duration}`);
    lines.push('');

    // Body/Adaptation Notes
    lines.push('### Adaptation');
    lines.push('');
    v.body.forEach((l) => {
      if (l.startsWith('  ')) {
        lines.push(l);
      } else if (l === '') {
        lines.push('');
      } else {
        lines.push(`${l}`);
      }
    });
    lines.push('');

    // CTA
    lines.push(`**CTA:** ${v.cta}`);
    lines.push('');

    // Platform-specific fields
    if (v.caption) {
      lines.push('### Caption');
      lines.push('```');
      lines.push(v.caption);
      lines.push('```');
      lines.push('');
    }

    if (v.singleTweet) {
      lines.push('### Single Tweet');
      lines.push('```');
      lines.push(v.singleTweet);
      lines.push('```');
      lines.push('');
    }

    if (v.thread) {
      lines.push('### Thread');
      lines.push('');
      v.thread.forEach((t) => {
        lines.push(`> ${t}`);
        lines.push('');
      });
    }

    if (v.title) {
      lines.push(`**Title:** ${v.title}`);
      lines.push('');
    }

    if (v.description) {
      lines.push('### Description');
      lines.push('```');
      lines.push(v.description);
      lines.push('```');
      lines.push('');
    }

    if (v.pinTitle) {
      lines.push(`**Pin Title:** ${v.pinTitle}`);
      lines.push('');
    }

    if (v.pinDescription) {
      lines.push('### Pin Description');
      lines.push('```');
      lines.push(v.pinDescription);
      lines.push('```');
      lines.push('');
    }

    // Hashtags
    if (v.hashtags && v.hashtags.length > 0) {
      lines.push(`**Hashtags:** ${v.hashtags.join(' ')}`);
      lines.push('');
    }

    // Notes
    if (v.notes && v.notes.length > 0) {
      lines.push('### Platform Notes');
      lines.push('');
      v.notes.forEach((n) => lines.push(`- ${n}`));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const scripts = findScripts();

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const repurposeDir = join(OUTPUT_DIR, 'repurposed');
  if (!existsSync(repurposeDir)) {
    mkdirSync(repurposeDir, { recursive: true });
  }

  for (const script of scripts) {
    const versions = repurposeScript(script);
    const md = repurposeToMarkdown(versions);

    const slug = script.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const mdPath = join(repurposeDir, `${script.id}-${slug}.md`);
    writeFileSync(mdPath, md, 'utf-8');

    const jsonPath = join(repurposeDir, `${script.id}-${slug}.json`);
    writeFileSync(jsonPath, JSON.stringify(versions, null, 2), 'utf-8');

    console.log(`Repurposed: ${script.title}`);
    console.log(`  MD:   ${mdPath}`);
    console.log(`  JSON: ${jsonPath}`);
  }

  console.log('');
  console.log(`Total scripts repurposed: ${scripts.length}`);
  console.log(`Platforms per script: 6 (TikTok, Reels, Shorts, Pinterest, Twitter/X, Facebook)`);
  console.log(`Total content pieces: ${scripts.length * 6}`);
}

main();
