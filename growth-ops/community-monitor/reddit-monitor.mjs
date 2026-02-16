#!/usr/bin/env node
// =============================================================================
// USA Gummies — Reddit Community Monitor
//
// Scans target subreddits for posts matching our keyword list using Reddit's
// public JSON API (no auth required). Outputs matched posts to a JSON file
// for downstream response generation.
//
// Usage:
//   node reddit-monitor.mjs
//   node reddit-monitor.mjs --dry-run   (print matches, don't write file)
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  SUBREDDITS,
  KEYWORDS,
  REDDIT_SETTINGS,
  RESPONSE_SETTINGS,
  PATHS,
} from './config.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON from a URL with a simple retry.
 */
async function fetchJSON(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': REDDIT_SETTINGS.userAgent,
          'Accept': 'application/json',
        },
      });

      if (res.status === 429) {
        const wait = (attempt + 1) * 5000;
        log(`  Rate limited. Waiting ${wait / 1000}s before retry...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      log(`  Fetch error (attempt ${attempt + 1}): ${err.message}`);
      await sleep(2000);
    }
  }
}

/**
 * Build regex patterns from keyword list for efficient matching.
 */
function buildKeywordPatterns(keywords) {
  return keywords.map((kw) => ({
    keyword: kw,
    regex: new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  }));
}

/**
 * Check which keywords match in a given text.
 */
function findMatches(text, patterns) {
  if (!text) return [];
  return patterns
    .filter((p) => p.regex.test(text))
    .map((p) => p.keyword);
}

/**
 * Calculate a relevance score based on keyword density and post engagement.
 */
function calculateRelevance(post, matchedKeywords) {
  let score = 0;

  // More keyword matches = more relevant
  score += matchedKeywords.length * 15;

  // Post engagement signals
  if (post.score > 50) score += 10;
  else if (post.score > 10) score += 5;
  else if (post.score > 0) score += 2;

  if (post.num_comments > 20) score += 10;
  else if (post.num_comments > 5) score += 5;
  else if (post.num_comments > 0) score += 2;

  // Title match is stronger signal than body match
  const titleMatches = matchedKeywords.filter((kw) => {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(post.title);
  });
  score += titleMatches.length * 5;

  // Cap at 100
  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// Main scanning logic
// ---------------------------------------------------------------------------

async function scanSubreddit(subreddit, patterns) {
  const url = `${REDDIT_SETTINGS.baseUrl}/r/${subreddit}/${REDDIT_SETTINGS.sort}.json?limit=${REDDIT_SETTINGS.postsPerSubreddit}&raw_json=1`;
  log(`Scanning r/${subreddit} ...`);

  let data;
  try {
    data = await fetchJSON(url);
  } catch (err) {
    log(`  ERROR scanning r/${subreddit}: ${err.message}`);
    return [];
  }

  if (!data?.data?.children) {
    log(`  No data returned for r/${subreddit}`);
    return [];
  }

  const cutoff = Date.now() / 1000 - RESPONSE_SETTINGS.maxPostAgeHours * 3600;
  const matches = [];

  for (const child of data.data.children) {
    const post = child.data;

    // Skip stickied/pinned posts
    if (post.stickied) continue;

    // Skip posts older than cutoff
    if (post.created_utc < cutoff) continue;

    // Combine title + selftext for matching
    const searchText = `${post.title} ${post.selftext || ''}`;
    const matchedKeywords = findMatches(searchText, patterns);

    if (matchedKeywords.length === 0) continue;

    const relevance = calculateRelevance(post, matchedKeywords);

    matches.push({
      id: post.id,
      title: post.title,
      selftext: (post.selftext || '').slice(0, 500),
      url: `https://www.reddit.com${post.permalink}`,
      subreddit: post.subreddit,
      author: post.author,
      score: post.score,
      num_comments: post.num_comments,
      created_utc: post.created_utc,
      created_date: new Date(post.created_utc * 1000).toISOString(),
      matched_keywords: matchedKeywords,
      relevance_score: relevance,
      is_self: post.is_self,
      link_flair_text: post.link_flair_text || null,
    });
  }

  log(`  Found ${matches.length} matching posts in r/${subreddit}`);
  return matches;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateWithExisting(newMatches, existingPath) {
  let existing = [];
  if (existsSync(existingPath)) {
    try {
      existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
    } catch {
      existing = [];
    }
  }

  const existingIds = new Set(existing.map((m) => m.id));
  const fresh = newMatches.filter((m) => !existingIds.has(m.id));

  // Merge: new matches first, then existing (keep last 500)
  const merged = [...fresh, ...existing].slice(0, 500);
  return { merged, newCount: fresh.length };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runRedditMonitor() {
  const dryRun = process.argv.includes('--dry-run');
  const startTime = Date.now();

  log('=== Reddit Monitor Starting ===');
  log(`Monitoring ${SUBREDDITS.length} subreddits for ${KEYWORDS.length} keywords`);

  const patterns = buildKeywordPatterns(KEYWORDS);
  const allMatches = [];

  for (const subreddit of SUBREDDITS) {
    const matches = await scanSubreddit(subreddit, patterns);
    allMatches.push(...matches);

    // Respect rate limits
    await sleep(REDDIT_SETTINGS.requestDelayMs);
  }

  // Sort by relevance score descending
  allMatches.sort((a, b) => b.relevance_score - a.relevance_score);

  // Deduplicate with existing data
  const { merged, newCount } = deduplicateWithExisting(allMatches, PATHS.redditMatches);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nScan complete in ${elapsed}s`);
  log(`Total matches this run: ${allMatches.length}`);
  log(`New matches (not previously seen): ${newCount}`);
  log(`Total in database: ${merged.length}`);

  if (dryRun) {
    log('\n--- DRY RUN — not writing file ---');
    for (const m of allMatches.slice(0, 10)) {
      log(`  [${m.relevance_score}] r/${m.subreddit}: ${m.title.slice(0, 80)}`);
      log(`    Keywords: ${m.matched_keywords.join(', ')}`);
      log(`    Score: ${m.score} | Comments: ${m.num_comments}`);
    }
  } else {
    // Ensure data directory exists
    const dir = dirname(PATHS.redditMatches);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(PATHS.redditMatches, JSON.stringify(merged, null, 2));
    log(`Wrote ${merged.length} matches to ${PATHS.redditMatches}`);
  }

  log('=== Reddit Monitor Complete ===\n');

  return { total: allMatches.length, new: newCount, matches: allMatches };
}

// Run directly if called as main script
if (process.argv[1] && process.argv[1].includes('reddit-monitor')) {
  runRedditMonitor().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
