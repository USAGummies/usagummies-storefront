#!/usr/bin/env node
// ============================================================================
// USA Gummies — Influencer Results & ROI Tracker
// ============================================================================
//
// Track the ROI of influencer outreach campaigns.
//
// Usage:
//   node results.mjs                     # full report
//   node results.mjs --format json       # JSON output
//   node results.mjs --export            # save markdown report to data/
//   node results.mjs --posts             # list all known post URLs
//   node results.mjs --cost-analysis     # detailed cost breakdown
//
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PATHS, PRODUCT_TIERS, DEFAULT_TIER, REACH_ESTIMATES, PIPELINE_STAGES } from './config.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = (f) => args.includes(f);

const format = getArg('--format') || 'text';
const doExport = hasFlag('--export');
const showPosts = hasFlag('--posts');
const costAnalysis = hasFlag('--cost-analysis');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function loadInfluencers() {
  if (!existsSync(PATHS.influencersDb)) {
    return { version: 1, lastUpdated: null, influencers: [] };
  }
  return JSON.parse(readFileSync(PATHS.influencersDb, 'utf-8'));
}

function loadInteractions() {
  if (!existsSync(PATHS.interactionsDb)) {
    return { version: 1, lastUpdated: null, interactions: [] };
  }
  return JSON.parse(readFileSync(PATHS.interactionsDb, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Calculate results
// ---------------------------------------------------------------------------
function calculateResults(influencers, interactions) {
  const total = influencers.length;

  // Stage counts
  const stageCounts = {};
  for (const stage of PIPELINE_STAGES) {
    stageCounts[stage.id] = 0;
  }
  for (const inf of influencers) {
    stageCounts[inf.stage] = (stageCounts[inf.stage] || 0) + 1;
  }

  // Contacted = everyone not in 'discovered'
  const contacted = influencers.filter(i => i.stage !== 'discovered').length;

  // Responded = responded + product_sent + posted + relationship_active
  const responded = influencers.filter(i =>
    ['responded', 'product_sent', 'posted', 'relationship_active'].includes(i.stage)
  ).length;

  // Product sent
  const sent = influencers.filter(i =>
    ['product_sent', 'posted', 'relationship_active'].includes(i.stage)
  ).length;

  // Posted
  const posted = influencers.filter(i =>
    ['posted', 'relationship_active'].includes(i.stage)
  ).length;

  // Active relationships
  const active = influencers.filter(i => i.stage === 'relationship_active').length;

  // Declined / unresponsive
  const declined = stageCounts.declined || 0;
  const unresponsive = stageCounts.unresponsive || 0;

  // Rates
  const responseRate = contacted > 0 ? responded / contacted : 0;
  const postRate = sent > 0 ? posted / sent : 0;
  const contactRate = total > 0 ? contacted / total : 0;

  // Reach calculations
  let totalFollowersPosted = 0;
  let estimatedImpressions = 0;
  const postsByPlatform = { instagram: 0, tiktok: 0, youtube: 0 };

  for (const inf of influencers) {
    if (['posted', 'relationship_active'].includes(inf.stage)) {
      const followers = inf.followerCount || 0;
      totalFollowersPosted += followers;
      postsByPlatform[inf.platform] = (postsByPlatform[inf.platform] || 0) + 1;

      const reachConfig = REACH_ESTIMATES[inf.platform] || { reachRate: 0.20 };
      estimatedImpressions += Math.round(followers * reachConfig.reachRate);
    }
  }

  // Cost calculations
  let totalCost = 0;
  const costBreakdown = [];

  for (const inf of influencers) {
    if (['product_sent', 'posted', 'relationship_active'].includes(inf.stage)) {
      const tier = PRODUCT_TIERS[inf.productTier || DEFAULT_TIER];
      totalCost += tier.cogs;
      costBreakdown.push({
        username: inf.username,
        platform: inf.platform,
        tier: tier.label,
        cost: tier.cogs,
        posted: ['posted', 'relationship_active'].includes(inf.stage),
        followers: inf.followerCount || 0,
      });
    }
  }

  const costPerImpression = estimatedImpressions > 0 ? totalCost / estimatedImpressions : 0;
  const costPerPost = posted > 0 ? totalCost / posted : 0;
  const costPerResponse = responded > 0 ? totalCost / responded : 0;

  // Post URLs
  const allPostUrls = [];
  for (const inf of influencers) {
    if (inf.postUrls && inf.postUrls.length > 0) {
      for (const url of inf.postUrls) {
        allPostUrls.push({
          username: inf.username,
          platform: inf.platform,
          url,
          followers: inf.followerCount || 0,
          ftcDisclosed: inf.ftcDisclosed,
        });
      }
    }
  }

  // FTC compliance
  const postersWithFtc = influencers.filter(i =>
    ['posted', 'relationship_active'].includes(i.stage)
  );
  const ftcCompliant = postersWithFtc.filter(i => i.ftcDisclosed === true).length;
  const ftcNonCompliant = postersWithFtc.filter(i => i.ftcDisclosed === false).length;
  const ftcUnknown = postersWithFtc.filter(i => i.ftcDisclosed === null || i.ftcDisclosed === undefined).length;

  // Platform breakdown
  const platformBreakdown = {};
  for (const inf of influencers) {
    if (!platformBreakdown[inf.platform]) {
      platformBreakdown[inf.platform] = { total: 0, contacted: 0, responded: 0, posted: 0, followers: 0 };
    }
    platformBreakdown[inf.platform].total++;
    if (inf.stage !== 'discovered') platformBreakdown[inf.platform].contacted++;
    if (['responded', 'product_sent', 'posted', 'relationship_active'].includes(inf.stage)) {
      platformBreakdown[inf.platform].responded++;
    }
    if (['posted', 'relationship_active'].includes(inf.stage)) {
      platformBreakdown[inf.platform].posted++;
      platformBreakdown[inf.platform].followers += inf.followerCount || 0;
    }
  }

  // Niche breakdown
  const nicheBreakdown = {};
  for (const inf of influencers) {
    for (const niche of (inf.niches || ['other'])) {
      if (!nicheBreakdown[niche]) {
        nicheBreakdown[niche] = { total: 0, posted: 0, followers: 0 };
      }
      nicheBreakdown[niche].total++;
      if (['posted', 'relationship_active'].includes(inf.stage)) {
        nicheBreakdown[niche].posted++;
        nicheBreakdown[niche].followers += inf.followerCount || 0;
      }
    }
  }

  return {
    summary: {
      total,
      contacted,
      responded,
      sent,
      posted,
      active,
      declined,
      unresponsive,
    },
    rates: {
      contactRate,
      responseRate,
      postRate,
    },
    reach: {
      totalFollowersPosted,
      estimatedImpressions,
      postsByPlatform,
    },
    cost: {
      totalCost,
      costPerImpression,
      costPerPost,
      costPerResponse,
      breakdown: costBreakdown,
    },
    ftc: {
      compliant: ftcCompliant,
      nonCompliant: ftcNonCompliant,
      unknown: ftcUnknown,
    },
    posts: allPostUrls,
    platformBreakdown,
    nicheBreakdown,
    stageCounts,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Text report
// ---------------------------------------------------------------------------
function printTextReport(results) {
  const r = results;

  console.log('\n' + '='.repeat(60));
  console.log('  USA GUMMIES -- INFLUENCER CAMPAIGN RESULTS');
  console.log('='.repeat(60));
  console.log(`  Generated: ${new Date().toLocaleString()}`);
  console.log('');

  // Pipeline summary
  console.log('--- PIPELINE SUMMARY ---');
  console.log(`  Total Discovered:     ${r.summary.total}`);
  console.log(`  Contacted:            ${r.summary.contacted}`);
  console.log(`  Responded:            ${r.summary.responded}`);
  console.log(`  Product Sent:         ${r.summary.sent}`);
  console.log(`  Posted:               ${r.summary.posted}`);
  console.log(`  Active Relationships: ${r.summary.active}`);
  console.log(`  Declined:             ${r.summary.declined}`);
  console.log(`  Unresponsive:         ${r.summary.unresponsive}`);
  console.log('');

  // Conversion rates
  console.log('--- CONVERSION RATES ---');
  console.log(`  Contact Rate:   ${(r.rates.contactRate * 100).toFixed(1)}% (${r.summary.contacted}/${r.summary.total})`);
  console.log(`  Response Rate:  ${(r.rates.responseRate * 100).toFixed(1)}% (${r.summary.responded}/${r.summary.contacted})`);
  console.log(`  Post Rate:      ${(r.rates.postRate * 100).toFixed(1)}% (${r.summary.posted}/${r.summary.sent})`);
  console.log('');

  // Reach
  console.log('--- REACH & IMPRESSIONS ---');
  console.log(`  Total Followers (posters): ${r.reach.totalFollowersPosted.toLocaleString()}`);
  console.log(`  Est. Impressions:          ${r.reach.estimatedImpressions.toLocaleString()}`);
  for (const [platform, count] of Object.entries(r.reach.postsByPlatform)) {
    if (count > 0) console.log(`    ${platform}: ${count} post(s)`);
  }
  console.log('');

  // Cost / ROI
  console.log('--- COST & ROI ---');
  console.log(`  Total Product Cost:     $${r.cost.totalCost.toFixed(2)}`);
  console.log(`  Cost per Post:          $${r.cost.costPerPost.toFixed(2)}`);
  console.log(`  Cost per Impression:    $${r.cost.costPerImpression.toFixed(4)}`);
  console.log(`  CPM (cost per 1K):      $${(r.cost.costPerImpression * 1000).toFixed(2)}`);
  console.log('');

  // FTC compliance
  console.log('--- FTC COMPLIANCE ---');
  console.log(`  Properly Disclosed:  ${r.ftc.compliant}`);
  console.log(`  Not Disclosed:       ${r.ftc.nonCompliant}`);
  console.log(`  Unknown / Unchecked: ${r.ftc.unknown}`);
  console.log('');

  // Platform breakdown
  console.log('--- BY PLATFORM ---');
  for (const [platform, data] of Object.entries(r.platformBreakdown)) {
    console.log(`  ${platform}:`);
    console.log(`    Total: ${data.total} | Contacted: ${data.contacted} | Responded: ${data.responded} | Posted: ${data.posted}`);
    if (data.followers > 0) console.log(`    Poster followers: ${data.followers.toLocaleString()}`);
  }
  console.log('');

  // Niche breakdown
  console.log('--- BY NICHE ---');
  const sortedNiches = Object.entries(r.nicheBreakdown).sort((a, b) => b[1].total - a[1].total);
  for (const [niche, data] of sortedNiches) {
    console.log(`  ${niche.padEnd(20)} total: ${data.total}  posted: ${data.posted}  followers: ${data.followers.toLocaleString()}`);
  }
  console.log('');

  // Posts
  if (r.posts.length > 0) {
    console.log('--- POSTS ---');
    for (const post of r.posts) {
      const ftcIcon = post.ftcDisclosed === true ? '[FTC OK]' : post.ftcDisclosed === false ? '[NO FTC]' : '[?]';
      console.log(`  @${post.username} (${post.platform}) ${ftcIcon}`);
      console.log(`    ${post.url}`);
    }
    console.log('');
  }

  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------
function generateMarkdownReport(results) {
  const r = results;
  const lines = [];

  lines.push('# USA Gummies -- Influencer Campaign Results');
  lines.push('');
  lines.push(`*Generated: ${new Date().toLocaleString()}*`);
  lines.push('');

  lines.push('## Pipeline Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Discovered | ${r.summary.total} |`);
  lines.push(`| Contacted | ${r.summary.contacted} |`);
  lines.push(`| Responded | ${r.summary.responded} |`);
  lines.push(`| Product Sent | ${r.summary.sent} |`);
  lines.push(`| Posted | ${r.summary.posted} |`);
  lines.push(`| Active Relationships | ${r.summary.active} |`);
  lines.push(`| Declined | ${r.summary.declined} |`);
  lines.push(`| Unresponsive | ${r.summary.unresponsive} |`);
  lines.push('');

  lines.push('## Conversion Rates');
  lines.push('');
  lines.push(`- **Contact Rate:** ${(r.rates.contactRate * 100).toFixed(1)}%`);
  lines.push(`- **Response Rate:** ${(r.rates.responseRate * 100).toFixed(1)}%`);
  lines.push(`- **Post Rate:** ${(r.rates.postRate * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('## Reach & Impressions');
  lines.push('');
  lines.push(`- **Total Followers (posters):** ${r.reach.totalFollowersPosted.toLocaleString()}`);
  lines.push(`- **Estimated Impressions:** ${r.reach.estimatedImpressions.toLocaleString()}`);
  lines.push('');

  lines.push('## Cost & ROI');
  lines.push('');
  lines.push(`- **Total Product Cost:** $${r.cost.totalCost.toFixed(2)}`);
  lines.push(`- **Cost per Post:** $${r.cost.costPerPost.toFixed(2)}`);
  lines.push(`- **Cost per Impression:** $${r.cost.costPerImpression.toFixed(4)}`);
  lines.push(`- **CPM (cost per 1K impressions):** $${(r.cost.costPerImpression * 1000).toFixed(2)}`);
  lines.push('');

  lines.push('## FTC Compliance');
  lines.push('');
  lines.push(`- Properly Disclosed: ${r.ftc.compliant}`);
  lines.push(`- Not Disclosed: ${r.ftc.nonCompliant}`);
  lines.push(`- Unknown: ${r.ftc.unknown}`);
  lines.push('');

  if (r.posts.length > 0) {
    lines.push('## Posts');
    lines.push('');
    for (const post of r.posts) {
      const ftc = post.ftcDisclosed === true ? 'FTC OK' : post.ftcDisclosed === false ? 'NO FTC' : '?';
      lines.push(`- [@${post.username}](${post.url}) (${post.platform}, ${post.followers.toLocaleString()} followers) [${ftc}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cost analysis detail
// ---------------------------------------------------------------------------
function printCostAnalysis(results) {
  console.log('\n=== COST ANALYSIS ===\n');

  if (results.cost.breakdown.length === 0) {
    console.log('No product has been sent yet.');
    return;
  }

  console.log('Shipments:');
  for (const item of results.cost.breakdown) {
    const status = item.posted ? 'POSTED' : 'waiting';
    console.log(`  @${item.username.padEnd(25)} ${item.platform.padEnd(10)} ${item.tier.padEnd(15)} $${item.cost.toFixed(2).padStart(6)} [${status}]`);
  }

  console.log(`\n  Total: $${results.cost.totalCost.toFixed(2)} across ${results.cost.breakdown.length} shipments`);

  const postedCost = results.cost.breakdown.filter(i => i.posted).reduce((s, i) => s + i.cost, 0);
  const wastedCost = results.cost.breakdown.filter(i => !i.posted).reduce((s, i) => s + i.cost, 0);

  console.log(`  Effective spend (led to posts): $${postedCost.toFixed(2)}`);
  console.log(`  Pending (no post yet):          $${wastedCost.toFixed(2)}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Posts list
// ---------------------------------------------------------------------------
function printPosts(results) {
  console.log('\n=== ALL POSTS ===\n');

  if (results.posts.length === 0) {
    console.log('No posts recorded yet.');
    return;
  }

  for (const post of results.posts) {
    const ftc = post.ftcDisclosed === true ? '[FTC OK]' : post.ftcDisclosed === false ? '[NO FTC]' : '[?]';
    console.log(`@${post.username} (${post.platform}, ${post.followers.toLocaleString()} followers) ${ftc}`);
    console.log(`  ${post.url}`);
    console.log('');
  }

  console.log(`Total: ${results.posts.length} post(s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const db = loadInfluencers();
  const idb = loadInteractions();
  const results = calculateResults(db.influencers, idb.interactions);

  if (showPosts) {
    printPosts(results);
    return;
  }

  if (costAnalysis) {
    printCostAnalysis(results);
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printTextReport(results);

  if (doExport) {
    const report = generateMarkdownReport(results);
    const outPath = join(PATHS.dataDir, `results-report-${new Date().toISOString().slice(0, 10)}.md`);
    writeFileSync(outPath, report);
    console.log(`\nReport exported to: ${outPath}`);
  }
}

main();
