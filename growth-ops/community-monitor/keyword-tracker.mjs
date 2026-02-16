#!/usr/bin/env node
// =============================================================================
// USA Gummies — Keyword & Competitor Tracker
//
// Tracks trending conversations and competitor mentions across:
//   1. Reddit search (public JSON API) for competitor + complaint combos
//   2. Google Trends RSS for keyword interest signals
//   3. Reddit search for our target keywords trending in the last 24h
//
// No API keys required — all public endpoints.
//
// Usage:
//   node keyword-tracker.mjs
//   node keyword-tracker.mjs --dry-run
// =============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  KEYWORDS,
  COMPETITORS,
  COMPLAINT_KEYWORDS,
  REDDIT_SETTINGS,
  TRACKER_SETTINGS,
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
        log(`  Rate limited. Waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(2000);
    }
  }
}

async function fetchText(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': REDDIT_SETTINGS.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(2000);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Competitor + Complaint tracking via Reddit search
// ---------------------------------------------------------------------------

async function trackCompetitorComplaints() {
  log('--- Tracking competitor complaints on Reddit ---');
  const results = [];

  // Build search queries: each competitor paired with complaint keywords
  const queries = [];
  for (const competitor of COMPETITORS) {
    // Search for competitor name alongside complaint terms
    const complaintTerms = COMPLAINT_KEYWORDS.slice(0, 5).join(' OR ');
    queries.push({
      competitor,
      query: `"${competitor}" (${complaintTerms})`,
    });
  }

  for (const { competitor, query } of queries) {
    const encoded = encodeURIComponent(query);
    const url = `${REDDIT_SETTINGS.baseUrl}/search.json?q=${encoded}&sort=new&t=week&limit=10&raw_json=1`;

    log(`  Searching: ${competitor} + complaints`);

    try {
      const data = await fetchJSON(url);
      const posts = data?.data?.children || [];

      for (const child of posts) {
        const post = child.data;
        if (post.stickied) continue;

        results.push({
          competitor,
          title: post.title,
          url: `https://www.reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
          created_utc: post.created_utc,
          created_date: new Date(post.created_utc * 1000).toISOString(),
          snippet: (post.selftext || '').slice(0, 300),
        });
      }

      log(`    Found ${posts.length} results for ${competitor}`);
    } catch (err) {
      log(`    ERROR searching ${competitor}: ${err.message}`);
    }

    await sleep(REDDIT_SETTINGS.requestDelayMs);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Trending keyword search via Reddit
// ---------------------------------------------------------------------------

async function trackTrendingKeywords() {
  log('--- Tracking trending keywords on Reddit ---');
  const results = [];

  // Pick a subset of our most important keywords to avoid too many requests
  const priorityKeywords = [
    'dye free candy',
    'artificial dyes food',
    'Red 40',
    'made in usa candy',
    'natural gummies',
    'titanium dioxide food',
    'healthy gummy bears',
    'kids snacks no dye',
  ];

  for (const keyword of priorityKeywords) {
    const encoded = encodeURIComponent(keyword);
    const url = `${REDDIT_SETTINGS.baseUrl}/search.json?q=${encoded}&sort=relevance&t=day&limit=5&raw_json=1`;

    log(`  Searching trending: "${keyword}"`);

    try {
      const data = await fetchJSON(url);
      const posts = data?.data?.children || [];

      for (const child of posts) {
        const post = child.data;
        if (post.stickied) continue;

        results.push({
          keyword,
          title: post.title,
          url: `https://www.reddit.com${post.permalink}`,
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
          created_utc: post.created_utc,
          created_date: new Date(post.created_utc * 1000).toISOString(),
        });
      }
    } catch (err) {
      log(`    ERROR: ${err.message}`);
    }

    await sleep(REDDIT_SETTINGS.requestDelayMs);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. Google Trends — parse trending searches RSS
// ---------------------------------------------------------------------------

async function trackGoogleTrends() {
  log('--- Checking Google Trends RSS ---');
  const trendingItems = [];

  try {
    const url = `${TRACKER_SETTINGS.googleTrendsBase}?geo=US`;
    const xml = await fetchText(url);

    // Simple XML parsing — extract <item> titles
    const titleRegex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g;
    let match;
    while ((match = titleRegex.exec(xml)) !== null) {
      const trendTitle = match[1].trim();

      // Check if any of our keywords appear in trending searches
      const relevantKeywords = KEYWORDS.filter((kw) => {
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        return regex.test(trendTitle);
      });

      if (relevantKeywords.length > 0) {
        trendingItems.push({
          trend: trendTitle,
          matched_keywords: relevantKeywords,
          source: 'google_trends',
        });
      }
    }

    log(`  Found ${trendingItems.length} relevant Google Trends items`);
  } catch (err) {
    log(`  Google Trends fetch failed (non-critical): ${err.message}`);
  }

  return trendingItems;
}

// ---------------------------------------------------------------------------
// 4. Build daily digest
// ---------------------------------------------------------------------------

function buildDigest(competitorData, trendingData, googleTrends) {
  const now = new Date().toISOString();

  // Summarize competitor complaints
  const competitorSummary = {};
  for (const item of competitorData) {
    if (!competitorSummary[item.competitor]) {
      competitorSummary[item.competitor] = { count: 0, topPosts: [] };
    }
    competitorSummary[item.competitor].count++;
    if (competitorSummary[item.competitor].topPosts.length < 3) {
      competitorSummary[item.competitor].topPosts.push({
        title: item.title,
        url: item.url,
        subreddit: item.subreddit,
        score: item.score,
      });
    }
  }

  // Summarize trending keywords
  const keywordSummary = {};
  for (const item of trendingData) {
    if (!keywordSummary[item.keyword]) {
      keywordSummary[item.keyword] = { count: 0, topPosts: [] };
    }
    keywordSummary[item.keyword].count++;
    if (keywordSummary[item.keyword].topPosts.length < 3) {
      keywordSummary[item.keyword].topPosts.push({
        title: item.title,
        url: item.url,
        subreddit: item.subreddit,
        score: item.score,
      });
    }
  }

  return {
    generated_at: now,
    report_period: '24h',
    competitor_complaints: {
      total_mentions: competitorData.length,
      by_brand: competitorSummary,
    },
    trending_keywords: {
      total_posts: trendingData.length,
      by_keyword: keywordSummary,
    },
    google_trends: googleTrends,
    raw_data: {
      competitor_posts: competitorData,
      keyword_posts: trendingData,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runKeywordTracker() {
  const dryRun = process.argv.includes('--dry-run');
  const startTime = Date.now();

  log('=== Keyword Tracker Starting ===');

  const [competitorData, trendingData, googleTrends] = await Promise.all([
    trackCompetitorComplaints(),
    trackTrendingKeywords(),
    trackGoogleTrends(),
  ]);

  const digest = buildDigest(competitorData, trendingData, googleTrends);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nKeyword tracking complete in ${elapsed}s`);
  log(`Competitor complaint posts: ${competitorData.length}`);
  log(`Trending keyword posts: ${trendingData.length}`);
  log(`Google Trends matches: ${googleTrends.length}`);

  if (dryRun) {
    log('\n--- DRY RUN ---');
    log('Competitor summary:');
    for (const [brand, info] of Object.entries(digest.competitor_complaints.by_brand)) {
      log(`  ${brand}: ${info.count} complaint posts`);
    }
    log('Trending keywords:');
    for (const [kw, info] of Object.entries(digest.trending_keywords.by_keyword)) {
      log(`  "${kw}": ${info.count} posts`);
    }
  } else {
    const dir = dirname(PATHS.keywordReport);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(PATHS.keywordReport, JSON.stringify(digest, null, 2));
    log(`Wrote keyword report to ${PATHS.keywordReport}`);
  }

  log('=== Keyword Tracker Complete ===\n');

  return digest;
}

// Run directly
if (process.argv[1] && process.argv[1].includes('keyword-tracker')) {
  runKeywordTracker().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
