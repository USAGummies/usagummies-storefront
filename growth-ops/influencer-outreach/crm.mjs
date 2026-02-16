#!/usr/bin/env node
// ============================================================================
// USA Gummies — Influencer CRM / Pipeline Manager
// ============================================================================
//
// Manage the influencer database: add, update status, tag, search, export.
//
// Usage:
//   node crm.mjs list                                          # list all
//   node crm.mjs list --stage discovered                       # filter by stage
//   node crm.mjs list --platform instagram                     # filter by platform
//   node crm.mjs list --niche mom-life                         # filter by niche
//   node crm.mjs list --search "username or keyword"           # search
//
//   node crm.mjs add --username janedoe --platform instagram   # add manually
//     [--followers 5000] [--email jane@email.com]
//     [--niche mom-life] [--bio "Mom of 3..."]
//     [--url https://instagram.com/janedoe]
//
//   node crm.mjs update <id> --stage contacted                 # update stage
//   node crm.mjs update <id> --note "Sent DM on Instagram"     # add note
//   node crm.mjs update <id> --email jane@email.com            # update field
//   node crm.mjs update <id> --niche fitness                   # add niche tag
//   node crm.mjs update <id> --address "123 Main, City, ST 12345"
//   node crm.mjs update <id> --tracking "1Z999AA10123456784"
//   node crm.mjs update <id> --post-url "https://instagram.com/p/abc123"
//   node crm.mjs update <id> --ftc-disclosed true
//   node crm.mjs update <id> --first-name "Jane"
//
//   node crm.mjs log <id> --action "Sent DM" [--details "Used fan_first template"]
//
//   node crm.mjs stats                                         # pipeline stats
//   node crm.mjs export                                        # export summary
//   node crm.mjs serve                                         # serve dashboard
//
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PATHS, PIPELINE_STAGES, STAGE_IDS, NICHE_LABELS } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const command = args[0];

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = (f) => args.includes(f);

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
function loadInfluencers() {
  if (!existsSync(PATHS.influencersDb)) {
    return { version: 1, lastUpdated: null, influencers: [] };
  }
  return JSON.parse(readFileSync(PATHS.influencersDb, 'utf-8'));
}

function saveInfluencers(db) {
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATHS.influencersDb, JSON.stringify(db, null, 2));
}

function loadInteractions() {
  if (!existsSync(PATHS.interactionsDb)) {
    return { version: 1, lastUpdated: null, interactions: [] };
  }
  return JSON.parse(readFileSync(PATHS.interactionsDb, 'utf-8'));
}

function saveInteractions(db) {
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATHS.interactionsDb, JSON.stringify(db, null, 2));
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------
function cmdList() {
  const db = loadInfluencers();
  let results = db.influencers;

  const stageFilter = getArg('--stage');
  const platformFilter = getArg('--platform');
  const nicheFilter = getArg('--niche');
  const searchQuery = getArg('--search');
  const limit = parseInt(getArg('--limit') || '50', 10);

  if (stageFilter) results = results.filter(i => i.stage === stageFilter);
  if (platformFilter) results = results.filter(i => i.platform === platformFilter);
  if (nicheFilter) results = results.filter(i => i.niches?.includes(nicheFilter));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    results = results.filter(i =>
      i.username.toLowerCase().includes(q) ||
      i.bio?.toLowerCase().includes(q) ||
      i.email?.toLowerCase().includes(q) ||
      i.notes?.toLowerCase().includes(q)
    );
  }

  console.log(`\nInfluencers: ${results.length} match${results.length === 1 ? '' : 'es'} (${db.influencers.length} total)\n`);

  if (results.length === 0) {
    console.log('No results. Try different filters or run `node discover.mjs` first.');
    return;
  }

  const showing = results.slice(0, limit);
  for (const i of showing) {
    const followers = i.followerCount ? `${(i.followerCount / 1000).toFixed(1)}K` : '?';
    const stage = PIPELINE_STAGES.find(s => s.id === i.stage)?.label || i.stage;
    console.log(
      `  [${stage.padEnd(20)}] @${i.username.padEnd(25)} ${i.platform.padEnd(10)} ${followers.padStart(7)} followers  ${i.niches?.join(', ') || ''}`
    );
    console.log(`  ${''.padEnd(22)} id: ${i.id}`);
    if (i.email) console.log(`  ${''.padEnd(22)} email: ${i.email}`);
    console.log('');
  }

  if (results.length > limit) {
    console.log(`  ... and ${results.length - limit} more. Use --limit to show more.`);
  }
}

// ---------------------------------------------------------------------------
// Command: add
// ---------------------------------------------------------------------------
function cmdAdd() {
  const username = getArg('--username');
  const platform = getArg('--platform');

  if (!username || !platform) {
    console.error('Required: --username and --platform');
    process.exit(1);
  }

  const db = loadInfluencers();

  // Check duplicate
  if (db.influencers.some(i => i.platform === platform && i.username.toLowerCase() === username.toLowerCase())) {
    console.error(`Duplicate: @${username} on ${platform} already exists.`);
    process.exit(1);
  }

  const niche = getArg('--niche');
  const influencer = {
    id: randomUUID(),
    username,
    firstName: getArg('--first-name') || null,
    platform,
    followerCount: getArg('--followers') ? parseInt(getArg('--followers'), 10) : null,
    bio: getArg('--bio') || null,
    email: getArg('--email') || null,
    engagementRate: null,
    profileUrl: getArg('--url') || buildProfileUrl(platform, username),
    channelId: null,
    niches: niche ? [niche] : [],
    tags: [],
    stage: 'discovered',
    discoveredVia: 'manual',
    discoveredAt: new Date().toISOString(),
    recentTopic: null,
    notes: getArg('--note') || '',
    shippingAddress: null,
    trackingNumber: null,
    productTier: null,
    postUrls: [],
    ftcDisclosed: null,
  };

  db.influencers.push(influencer);
  saveInfluencers(db);

  console.log(`\nAdded: @${username} (${platform})`);
  console.log(`ID: ${influencer.id}`);
}

function buildProfileUrl(platform, username) {
  switch (platform) {
    case 'instagram': return `https://instagram.com/${username}`;
    case 'tiktok': return `https://tiktok.com/@${username}`;
    case 'youtube': return `https://youtube.com/@${username}`;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Command: update
// ---------------------------------------------------------------------------
function cmdUpdate() {
  const id = args[1];
  if (!id) {
    console.error('Usage: node crm.mjs update <id> --field value');
    process.exit(1);
  }

  const db = loadInfluencers();
  const influencer = db.influencers.find(i => i.id === id);
  if (!influencer) {
    console.error(`Influencer not found: ${id}`);
    process.exit(1);
  }

  let changed = false;

  const stage = getArg('--stage');
  if (stage) {
    if (!STAGE_IDS.includes(stage)) {
      console.error(`Invalid stage: ${stage}. Valid: ${STAGE_IDS.join(', ')}`);
      process.exit(1);
    }
    influencer.stage = stage;
    changed = true;
    console.log(`  Stage -> ${stage}`);

    // Log the stage change as an interaction
    const idb = loadInteractions();
    idb.interactions.push({
      influencerId: id,
      type: 'stage_change',
      fromStage: influencer.stage,
      toStage: stage,
      timestamp: new Date().toISOString(),
    });
    saveInteractions(idb);
  }

  const note = getArg('--note');
  if (note) {
    influencer.notes = influencer.notes ? `${influencer.notes}\n[${new Date().toISOString()}] ${note}` : `[${new Date().toISOString()}] ${note}`;
    changed = true;
    console.log(`  Note added`);
  }

  const email = getArg('--email');
  if (email) {
    influencer.email = email;
    changed = true;
    console.log(`  Email -> ${email}`);
  }

  const firstName = getArg('--first-name');
  if (firstName) {
    influencer.firstName = firstName;
    changed = true;
    console.log(`  First name -> ${firstName}`);
  }

  const niche = getArg('--niche');
  if (niche) {
    if (!influencer.niches) influencer.niches = [];
    if (!influencer.niches.includes(niche)) {
      influencer.niches.push(niche);
      changed = true;
      console.log(`  Niche added: ${niche}`);
    }
  }

  const address = getArg('--address');
  if (address) {
    influencer.shippingAddress = address;
    changed = true;
    console.log(`  Address updated`);
  }

  const tracking = getArg('--tracking');
  if (tracking) {
    influencer.trackingNumber = tracking;
    changed = true;
    console.log(`  Tracking -> ${tracking}`);
  }

  const postUrl = getArg('--post-url');
  if (postUrl) {
    if (!influencer.postUrls) influencer.postUrls = [];
    influencer.postUrls.push(postUrl);
    changed = true;
    console.log(`  Post URL added: ${postUrl}`);
  }

  const ftc = getArg('--ftc-disclosed');
  if (ftc !== null && ftc !== undefined) {
    influencer.ftcDisclosed = ftc === 'true';
    changed = true;
    console.log(`  FTC disclosed -> ${influencer.ftcDisclosed}`);
  }

  const tier = getArg('--tier');
  if (tier) {
    influencer.productTier = tier;
    changed = true;
    console.log(`  Product tier -> ${tier}`);
  }

  if (changed) {
    saveInfluencers(db);
    console.log(`\nUpdated @${influencer.username}`);
  } else {
    console.log('No updates specified. Use flags like --stage, --note, --email, etc.');
  }
}

// ---------------------------------------------------------------------------
// Command: log (add interaction)
// ---------------------------------------------------------------------------
function cmdLog() {
  const id = args[1];
  const action = getArg('--action');

  if (!id || !action) {
    console.error('Usage: node crm.mjs log <id> --action "action description" [--details "..."]');
    process.exit(1);
  }

  const db = loadInfluencers();
  const influencer = db.influencers.find(i => i.id === id);
  if (!influencer) {
    console.error(`Influencer not found: ${id}`);
    process.exit(1);
  }

  const idb = loadInteractions();
  idb.interactions.push({
    influencerId: id,
    type: 'manual_log',
    action,
    details: getArg('--details') || null,
    timestamp: new Date().toISOString(),
  });
  saveInteractions(idb);

  console.log(`Logged: "${action}" for @${influencer.username}`);
}

// ---------------------------------------------------------------------------
// Command: stats
// ---------------------------------------------------------------------------
function cmdStats() {
  const db = loadInfluencers();
  const idb = loadInteractions();
  const total = db.influencers.length;

  console.log('\n=== Pipeline Stats ===\n');

  if (total === 0) {
    console.log('No influencers in database. Run `node discover.mjs` first.');
    return;
  }

  // Count by stage
  const stageCounts = {};
  for (const stage of PIPELINE_STAGES) {
    stageCounts[stage.id] = 0;
  }
  for (const i of db.influencers) {
    stageCounts[i.stage] = (stageCounts[i.stage] || 0) + 1;
  }

  for (const stage of PIPELINE_STAGES) {
    const count = stageCounts[stage.id] || 0;
    const bar = '#'.repeat(Math.ceil(count / total * 40));
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`  ${stage.label.padEnd(22)} ${String(count).padStart(5)}  ${pct.padStart(5)}%  ${bar}`);
  }

  console.log(`  ${''.padEnd(22)} ${'-----'.padStart(5)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(total).padStart(5)}`);

  // Conversion rates
  const contacted = stageCounts.contacted || 0;
  const responded = stageCounts.responded || 0;
  const sent = stageCounts.product_sent || 0;
  const posted = stageCounts.posted || 0;
  const active = stageCounts.relationship_active || 0;

  console.log('\n--- Conversion Rates ---');
  if (contacted > 0) {
    console.log(`  Response rate:    ${responded}/${contacted} = ${((responded / contacted) * 100).toFixed(1)}%`);
  }
  if (sent > 0) {
    console.log(`  Post rate:        ${posted}/${sent} = ${((posted / sent) * 100).toFixed(1)}%`);
  }

  // Platform breakdown
  console.log('\n--- By Platform ---');
  const platforms = {};
  for (const i of db.influencers) {
    platforms[i.platform] = (platforms[i.platform] || 0) + 1;
  }
  for (const [p, c] of Object.entries(platforms).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(12)} ${c}`);
  }

  // Niche breakdown
  console.log('\n--- By Niche ---');
  const niches = {};
  for (const i of db.influencers) {
    for (const n of (i.niches || [])) {
      niches[n] = (niches[n] || 0) + 1;
    }
  }
  for (const [n, c] of Object.entries(niches).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.padEnd(18)} ${c}`);
  }

  // Estimated reach
  const totalReach = db.influencers
    .filter(i => i.stage === 'posted' || i.stage === 'relationship_active')
    .reduce((sum, i) => sum + (i.followerCount || 0), 0);

  if (totalReach > 0) {
    console.log(`\n--- Estimated Reach ---`);
    console.log(`  Total followers (posted/active): ${totalReach.toLocaleString()}`);
    console.log(`  Est. impressions (20% reach):    ${Math.round(totalReach * 0.2).toLocaleString()}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Command: export
// ---------------------------------------------------------------------------
function cmdExport() {
  const db = loadInfluencers();

  // Export as a simple markdown report
  const lines = ['# USA Gummies Influencer Pipeline Report', ''];
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total influencers: ${db.influencers.length}`);
  lines.push('');

  for (const stage of PIPELINE_STAGES) {
    const inStage = db.influencers.filter(i => i.stage === stage.id);
    if (inStage.length === 0) continue;

    lines.push(`## ${stage.label} (${inStage.length})`);
    lines.push('');
    for (const i of inStage) {
      const followers = i.followerCount ? `${(i.followerCount / 1000).toFixed(1)}K` : '?';
      lines.push(`- **@${i.username}** (${i.platform}, ${followers} followers) — ${i.niches?.join(', ') || 'untagged'}`);
      if (i.email) lines.push(`  - Email: ${i.email}`);
      if (i.postUrls?.length) lines.push(`  - Posts: ${i.postUrls.join(', ')}`);
    }
    lines.push('');
  }

  const report = lines.join('\n');
  const outPath = join(PATHS.dataDir, 'pipeline-report.md');
  writeFileSync(outPath, report);
  console.log(`Report exported to: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Command: serve (serve the CRM dashboard)
// ---------------------------------------------------------------------------
function cmdServe() {
  const port = parseInt(getArg('--port') || '3456', 10);

  const server = createServer((req, res) => {
    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API endpoints
    if (req.url === '/api/influencers' && req.method === 'GET') {
      const db = loadInfluencers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db));
      return;
    }

    if (req.url === '/api/interactions' && req.method === 'GET') {
      const db = loadInteractions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db));
      return;
    }

    if (req.url === '/api/stages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PIPELINE_STAGES));
      return;
    }

    if (req.url?.startsWith('/api/influencer/') && req.method === 'PUT') {
      const id = req.url.split('/api/influencer/')[1];
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const updates = JSON.parse(body);
          const db = loadInfluencers();
          const influencer = db.influencers.find(i => i.id === id);
          if (!influencer) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }

          // Apply updates
          for (const [key, value] of Object.entries(updates)) {
            if (key === 'stage' && STAGE_IDS.includes(value)) {
              // Log stage change
              const idb = loadInteractions();
              idb.interactions.push({
                influencerId: id,
                type: 'stage_change',
                fromStage: influencer.stage,
                toStage: value,
                timestamp: new Date().toISOString(),
              });
              saveInteractions(idb);
            }
            influencer[key] = value;
          }

          saveInfluencers(db);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(influencer));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.url === '/api/influencer' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const db = loadInfluencers();

          const influencer = {
            id: randomUUID(),
            username: data.username || '',
            firstName: data.firstName || null,
            platform: data.platform || 'instagram',
            followerCount: data.followerCount || null,
            bio: data.bio || null,
            email: data.email || null,
            engagementRate: null,
            profileUrl: data.profileUrl || buildProfileUrl(data.platform || 'instagram', data.username || ''),
            channelId: null,
            niches: data.niches || [],
            tags: [],
            stage: 'discovered',
            discoveredVia: 'manual',
            discoveredAt: new Date().toISOString(),
            recentTopic: null,
            notes: data.notes || '',
            shippingAddress: null,
            trackingNumber: null,
            productTier: null,
            postUrls: [],
            ftcDisclosed: null,
          };

          db.influencers.push(influencer);
          saveInfluencers(db);

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(influencer));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Serve the dashboard HTML
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = join(__dirname, 'crm-dashboard.html');
      if (existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(htmlPath, 'utf-8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard HTML not found');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\nUSA Gummies Influencer CRM Dashboard`);
    console.log(`  http://localhost:${port}`);
    console.log(`\nAPI endpoints:`);
    console.log(`  GET  /api/influencers`);
    console.log(`  GET  /api/interactions`);
    console.log(`  GET  /api/stages`);
    console.log(`  POST /api/influencer`);
    console.log(`  PUT  /api/influencer/:id`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------
function showHelp() {
  console.log(`
USA Gummies Influencer CRM

Commands:
  list     List influencers (with optional filters)
  add      Add an influencer manually
  update   Update an influencer's fields
  log      Log an interaction
  stats    Show pipeline statistics
  export   Export pipeline report to markdown
  serve    Start the CRM dashboard web server

Run \`node crm.mjs <command> --help\` for details.
  `);
}

switch (command) {
  case 'list':   cmdList(); break;
  case 'add':    cmdAdd(); break;
  case 'update': cmdUpdate(); break;
  case 'log':    cmdLog(); break;
  case 'stats':  cmdStats(); break;
  case 'export': cmdExport(); break;
  case 'serve':  cmdServe(); break;
  default:       showHelp();
}
