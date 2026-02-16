#!/usr/bin/env node
// ============================================================================
// USA Gummies — Influencer Discovery Script
// ============================================================================
//
// Searches for micro-influencers across Instagram, TikTok, and YouTube using
// free public methods (web scraping of public pages / YouTube Data API free
// tier).
//
// Usage:
//   node discover.mjs                           # run all platforms, all hashtags
//   node discover.mjs --platform instagram      # Instagram only
//   node discover.mjs --hashtag MadeInUSA       # single hashtag
//   node discover.mjs --niche americanMade      # all hashtags in niche group
//   node discover.mjs --dry-run                 # show plan, don't scrape
//
// Results are appended to data/influencers.json
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  PATHS,
  ALL_HASHTAGS,
  TARGET_HASHTAGS,
  DISCOVERY,
  YOUTUBE,
  NICHE_LABELS,
} from './config.mjs';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = (f) => args.includes(f);

const platformFilter = getArg('--platform');
const hashtagFilter = getArg('--hashtag');
const nicheFilter = getArg('--niche');
const dryRun = hasFlag('--dry-run');

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
function loadDb() {
  if (!existsSync(PATHS.influencersDb)) {
    return { version: 1, lastUpdated: null, influencers: [] };
  }
  return JSON.parse(readFileSync(PATHS.influencersDb, 'utf-8'));
}

function saveDb(db) {
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATHS.influencersDb, JSON.stringify(db, null, 2));
}

function isDuplicate(db, platform, username) {
  return db.influencers.some(
    (i) => i.platform === platform && i.username.toLowerCase() === username.toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Build hashtag list based on filters
// ---------------------------------------------------------------------------
function getHashtags() {
  if (hashtagFilter) return [hashtagFilter];
  if (nicheFilter && TARGET_HASHTAGS[nicheFilter]) return TARGET_HASHTAGS[nicheFilter];
  return ALL_HASHTAGS;
}

// ---------------------------------------------------------------------------
// Build platform list based on filters
// ---------------------------------------------------------------------------
function getPlatforms() {
  if (platformFilter) return [platformFilter];
  return DISCOVERY.platforms;
}

// ---------------------------------------------------------------------------
// Instagram discovery (public hashtag page scraping)
// ---------------------------------------------------------------------------
async function discoverInstagram(hashtag) {
  const profiles = [];
  const url = `https://www.instagram.com/explore/tags/${hashtag}/`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.warn(`  [instagram] HTTP ${res.status} for #${hashtag} -- Instagram may require auth for hashtag pages`);
      return profiles;
    }

    const html = await res.text();

    // Try to extract shared data from the page
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
    const additionalDataMatch = html.match(/"edge_hashtag_to_media":\s*({.+?})\s*,\s*"edge_hashtag_to_top_posts"/);

    if (sharedDataMatch) {
      try {
        const data = JSON.parse(sharedDataMatch[1]);
        const edges =
          data?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_media?.edges || [];

        for (const edge of edges.slice(0, DISCOVERY.resultsPerHashtag)) {
          const node = edge.node;
          const owner = node.owner || {};
          profiles.push({
            username: owner.username || `user_${node.shortcode}`,
            platform: 'instagram',
            followerCount: null, // not available from hashtag page
            bio: null,
            email: null,
            engagementRate: node.edge_liked_by?.count
              ? node.edge_liked_by.count / (owner.edge_followed_by?.count || 1)
              : null,
            recentPostLikes: node.edge_liked_by?.count || null,
            recentPostComments: node.edge_media_to_comment?.count || null,
            profileUrl: `https://instagram.com/${owner.username || ''}`,
            discoveredVia: `#${hashtag}`,
            contentCategory: null,
          });
        }
      } catch (parseErr) {
        console.warn(`  [instagram] Failed to parse shared data for #${hashtag}`);
      }
    }

    // Also try to find usernames mentioned in the raw HTML as fallback
    if (profiles.length === 0) {
      const usernameMatches = html.matchAll(/"username":"([a-zA-Z0-9_.]+)"/g);
      const seen = new Set();
      for (const match of usernameMatches) {
        const username = match[1];
        if (!seen.has(username) && username !== 'instagram' && !username.startsWith('explore')) {
          seen.add(username);
          profiles.push({
            username,
            platform: 'instagram',
            followerCount: null,
            bio: null,
            email: null,
            engagementRate: null,
            recentPostLikes: null,
            recentPostComments: null,
            profileUrl: `https://instagram.com/${username}`,
            discoveredVia: `#${hashtag}`,
            contentCategory: null,
          });
        }
        if (profiles.length >= DISCOVERY.resultsPerHashtag) break;
      }
    }

    console.log(`  [instagram] #${hashtag}: found ${profiles.length} profiles`);
  } catch (err) {
    console.warn(`  [instagram] Error scraping #${hashtag}: ${err.message}`);
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// TikTok discovery (public web search)
// ---------------------------------------------------------------------------
async function discoverTiktok(hashtag) {
  const profiles = [];
  const url = `https://www.tiktok.com/tag/${hashtag}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.warn(`  [tiktok] HTTP ${res.status} for #${hashtag}`);
      return profiles;
    }

    const html = await res.text();

    // Try to parse SIGI_STATE or __UNIVERSAL_DATA_FOR_REHYDRATION__
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>({.+?})<\/script>/);
    const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>({.+?})<\/script>/);

    const dataStr = sigiMatch?.[1] || universalMatch?.[1];
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr);

        // Navigate through possible data structures
        const itemModule = data?.ItemModule || {};
        const items = Object.values(itemModule).length > 0
          ? Object.values(itemModule)
          : data?.__DEFAULT_SCOPE__?.['webapp.challenge-detail']?.itemList || [];

        const seen = new Set();
        for (const item of items.slice(0, DISCOVERY.resultsPerHashtag)) {
          const author = item.author || item.authorMeta || {};
          const username = author.uniqueId || author.nickname || item.authorId;
          if (!username || seen.has(username)) continue;
          seen.add(username);

          const stats = item.authorStats || item.stats || author;
          profiles.push({
            username,
            platform: 'tiktok',
            followerCount: stats.followerCount || stats.fans || null,
            bio: author.signature || null,
            email: null,
            engagementRate: null,
            recentPostLikes: item.stats?.diggCount || item.diggCount || null,
            recentPostComments: item.stats?.commentCount || item.commentCount || null,
            profileUrl: `https://tiktok.com/@${username}`,
            discoveredVia: `#${hashtag}`,
            contentCategory: null,
          });
        }
      } catch (parseErr) {
        console.warn(`  [tiktok] Failed to parse page data for #${hashtag}`);
      }
    }

    // Fallback: extract usernames from HTML
    if (profiles.length === 0) {
      const usernameMatches = html.matchAll(/"uniqueId":"([a-zA-Z0-9_.]+)"/g);
      const seen = new Set();
      for (const match of usernameMatches) {
        const username = match[1];
        if (!seen.has(username)) {
          seen.add(username);
          profiles.push({
            username,
            platform: 'tiktok',
            followerCount: null,
            bio: null,
            email: null,
            engagementRate: null,
            recentPostLikes: null,
            recentPostComments: null,
            profileUrl: `https://tiktok.com/@${username}`,
            discoveredVia: `#${hashtag}`,
            contentCategory: null,
          });
        }
        if (profiles.length >= DISCOVERY.resultsPerHashtag) break;
      }
    }

    console.log(`  [tiktok] #${hashtag}: found ${profiles.length} profiles`);
  } catch (err) {
    console.warn(`  [tiktok] Error scraping #${hashtag}: ${err.message}`);
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// YouTube discovery (YouTube Data API v3 — free tier)
// ---------------------------------------------------------------------------
async function discoverYoutube(hashtag) {
  const profiles = [];

  if (!YOUTUBE.apiKey) {
    console.warn('  [youtube] No API key set. Set YOUTUBE_API_KEY env var or update config.mjs');
    return profiles;
  }

  try {
    // Search for videos with the hashtag
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', `#${hashtag}`);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', Math.min(DISCOVERY.resultsPerHashtag, 50));
    searchUrl.searchParams.set('relevanceLanguage', 'en');
    searchUrl.searchParams.set('regionCode', 'US');
    searchUrl.searchParams.set('publishedAfter', new Date(Date.now() - 30 * 86400000).toISOString());
    searchUrl.searchParams.set('key', YOUTUBE.apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      console.warn(`  [youtube] API error ${searchRes.status} for #${hashtag}`);
      return profiles;
    }

    const searchData = await searchRes.json();
    const channelIds = [...new Set(searchData.items?.map(i => i.snippet.channelId) || [])];

    if (channelIds.length === 0) {
      console.log(`  [youtube] #${hashtag}: no results`);
      return profiles;
    }

    // Get channel details (subscriber counts, etc.)
    const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelsUrl.searchParams.set('part', 'snippet,statistics');
    channelsUrl.searchParams.set('id', channelIds.join(','));
    channelsUrl.searchParams.set('key', YOUTUBE.apiKey);

    const channelsRes = await fetch(channelsUrl.toString());
    if (!channelsRes.ok) {
      console.warn(`  [youtube] Channel API error ${channelsRes.status}`);
      return profiles;
    }

    const channelsData = await channelsRes.json();

    for (const channel of channelsData.items || []) {
      const subs = parseInt(channel.statistics?.subscriberCount || '0', 10);
      const views = parseInt(channel.statistics?.viewCount || '0', 10);
      const videoCount = parseInt(channel.statistics?.videoCount || '0', 10);

      // Apply follower filters
      if (subs < DISCOVERY.minFollowers || subs > DISCOVERY.maxFollowers) continue;
      if (channel.statistics?.hiddenSubscriberCount) continue;

      // Extract email from description if present
      const desc = channel.snippet?.description || '';
      const emailMatch = desc.match(/[\w.+-]+@[\w-]+\.[\w.]+/);

      profiles.push({
        username: channel.snippet.customUrl?.replace('@', '') || channel.snippet.title,
        platform: 'youtube',
        followerCount: subs,
        bio: desc.slice(0, 500),
        email: emailMatch?.[0] || null,
        engagementRate: videoCount > 0 ? (views / videoCount / subs) : null,
        recentPostLikes: null,
        recentPostComments: null,
        profileUrl: `https://youtube.com/${channel.snippet.customUrl || 'channel/' + channel.id}`,
        channelId: channel.id,
        discoveredVia: `#${hashtag}`,
        contentCategory: null,
      });
    }

    console.log(`  [youtube] #${hashtag}: found ${profiles.length} profiles (${channelIds.length} channels checked)`);
  } catch (err) {
    console.warn(`  [youtube] Error for #${hashtag}: ${err.message}`);
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Platform dispatch
// ---------------------------------------------------------------------------
const SCRAPERS = {
  instagram: discoverInstagram,
  tiktok: discoverTiktok,
  youtube: discoverYoutube,
};

// ---------------------------------------------------------------------------
// Detect niche from hashtag
// ---------------------------------------------------------------------------
function nicheFromHashtag(hashtag) {
  for (const [niche, tags] of Object.entries(TARGET_HASHTAGS)) {
    if (tags.some(t => t.toLowerCase() === hashtag.toLowerCase())) {
      // Map niche key to label
      const mapping = {
        americanMade: 'american-made',
        cleanEating: 'clean-eating',
        candy: 'candy-review',
        momLife: 'mom-life',
        fitness: 'fitness',
        patriotic: 'patriotic',
        homesteading: 'homesteading',
      };
      return mapping[niche] || niche;
    }
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Apply filters to a discovered profile
// ---------------------------------------------------------------------------
function passesFilters(profile) {
  // If we have follower count, enforce range
  if (profile.followerCount !== null) {
    if (profile.followerCount < DISCOVERY.minFollowers) return false;
    if (profile.followerCount > DISCOVERY.maxFollowers) return false;
  }

  // If we have engagement rate, enforce minimum
  if (profile.engagementRate !== null && profile.engagementRate < DISCOVERY.minEngagementRate) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main discovery loop
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== USA Gummies Influencer Discovery ===\n');

  const platforms = getPlatforms();
  const hashtags = getHashtags();

  console.log(`Platforms: ${platforms.join(', ')}`);
  console.log(`Hashtags: ${hashtags.length} total`);
  console.log(`Follower range: ${DISCOVERY.minFollowers.toLocaleString()} - ${DISCOVERY.maxFollowers.toLocaleString()}`);
  console.log(`Min engagement: ${(DISCOVERY.minEngagementRate * 100).toFixed(0)}%`);
  console.log('');

  if (dryRun) {
    console.log('[DRY RUN] Would search:');
    for (const platform of platforms) {
      for (const hashtag of hashtags) {
        console.log(`  ${platform} #${hashtag}`);
      }
    }
    console.log(`\nTotal searches: ${platforms.length * hashtags.length}`);
    return;
  }

  const db = loadDb();
  const startCount = db.influencers.length;
  let discovered = 0;
  let duplicates = 0;
  let filtered = 0;

  for (const platform of platforms) {
    const scraper = SCRAPERS[platform];
    if (!scraper) {
      console.warn(`Unknown platform: ${platform}`);
      continue;
    }

    console.log(`\n--- ${platform.toUpperCase()} ---`);

    for (const hashtag of hashtags) {
      const profiles = await scraper(hashtag);

      for (const profile of profiles) {
        // Skip duplicates
        if (isDuplicate(db, profile.platform, profile.username)) {
          duplicates++;
          continue;
        }

        // Apply filters
        if (!passesFilters(profile)) {
          filtered++;
          continue;
        }

        // Determine niche
        const niche = nicheFromHashtag(hashtag);

        // Create influencer record
        const influencer = {
          id: randomUUID(),
          username: profile.username,
          firstName: null,
          platform: profile.platform,
          followerCount: profile.followerCount,
          bio: profile.bio,
          email: profile.email,
          engagementRate: profile.engagementRate,
          profileUrl: profile.profileUrl,
          channelId: profile.channelId || null,
          niches: [niche],
          tags: [],
          stage: 'discovered',
          discoveredVia: profile.discoveredVia,
          discoveredAt: new Date().toISOString(),
          recentTopic: null,
          notes: '',
          shippingAddress: null,
          trackingNumber: null,
          productTier: null,
          postUrls: [],
          ftcDisclosed: null,
        };

        db.influencers.push(influencer);
        discovered++;
      }

      // Rate limit: small delay between requests
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  saveDb(db);

  console.log('\n=== Discovery Complete ===');
  console.log(`New profiles added: ${discovered}`);
  console.log(`Duplicates skipped: ${duplicates}`);
  console.log(`Filtered out: ${filtered}`);
  console.log(`Total in database: ${db.influencers.length}`);
  console.log(`Database: ${PATHS.influencersDb}`);
}

main().catch(console.error);
