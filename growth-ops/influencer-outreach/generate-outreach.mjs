#!/usr/bin/env node
// ============================================================================
// USA Gummies — Outreach Message Generator
// ============================================================================
//
// Generates personalized DM/email messages for discovered influencers.
//
// Usage:
//   node generate-outreach.mjs                        # generate for all 'discovered' influencers
//   node generate-outreach.mjs --id <uuid>            # single influencer
//   node generate-outreach.mjs --template fan_first   # specific template for all
//   node generate-outreach.mjs --preview              # show messages, don't save
//   node generate-outreach.mjs --all-variations       # generate all 4 variations for each
//   node generate-outreach.mjs --niche mom-life       # only influencers in this niche
//   node generate-outreach.mjs --platform instagram   # only influencers on this platform
//   node generate-outreach.mjs --best-fit             # auto-pick best template per influencer
//
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PATHS, TEMPLATE_IDS } from './config.mjs';
import { generateMessage, generateAllVariations, TEMPLATES } from './templates/outreach-templates.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = (f) => args.includes(f);

const targetId = getArg('--id');
const templateId = getArg('--template');
const preview = hasFlag('--preview');
const allVariations = hasFlag('--all-variations');
const nicheFilter = getArg('--niche');
const platformFilter = getArg('--platform');
const bestFit = hasFlag('--best-fit');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function loadDb() {
  return JSON.parse(readFileSync(PATHS.influencersDb, 'utf-8'));
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
// Best-fit template selection based on influencer attributes
// ---------------------------------------------------------------------------
function pickBestTemplate(influencer) {
  const niches = influencer.niches || [];
  const platform = influencer.platform;

  // Patriotic / military / american-made => mission alignment resonates
  if (niches.some(n => ['patriotic', 'american-made', 'military'].includes(n))) {
    return 'mission_alignment';
  }

  // Mom / kids => fan first feels most personal
  if (niches.some(n => ['mom-life', 'kids-snacks'].includes(n))) {
    return 'fan_first';
  }

  // Fitness / clean eating => collaboration (value-prop focused)
  if (niches.some(n => ['fitness', 'clean-eating', 'wellness'].includes(n))) {
    return 'collaboration';
  }

  // Candy / food review => exclusive VIP (makes them feel chosen)
  if (niches.some(n => ['candy-review', 'food-review'].includes(n))) {
    return 'exclusive_vip';
  }

  // Higher follower count => VIP treatment
  if (influencer.followerCount && influencer.followerCount > 20000) {
    return 'exclusive_vip';
  }

  // Default
  return 'fan_first';
}

// ---------------------------------------------------------------------------
// Format output for terminal
// ---------------------------------------------------------------------------
function printMessage(result, influencer) {
  console.log('---');
  console.log(`Influencer: @${influencer.username} (${influencer.platform})`);
  console.log(`Followers:  ${influencer.followerCount?.toLocaleString() || 'unknown'}`);
  console.log(`Niche:      ${influencer.niches?.join(', ') || 'unknown'}`);
  console.log(`Template:   ${result.templateLabel}`);
  console.log(`Words:      ${result.wordCount}`);
  console.log('');
  console.log(result.message);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== USA Gummies Outreach Message Generator ===\n');

  const db = loadDb();
  const interactionsDb = loadInteractions();

  // Select influencers
  let influencers = db.influencers;

  if (targetId) {
    influencers = influencers.filter(i => i.id === targetId);
    if (influencers.length === 0) {
      console.error(`No influencer found with id: ${targetId}`);
      process.exit(1);
    }
  } else {
    // Default: only discovered (not yet contacted)
    influencers = influencers.filter(i => i.stage === 'discovered');
  }

  if (nicheFilter) {
    influencers = influencers.filter(i => i.niches?.includes(nicheFilter));
  }

  if (platformFilter) {
    influencers = influencers.filter(i => i.platform === platformFilter);
  }

  if (influencers.length === 0) {
    console.log('No influencers match the current filters.');
    console.log('Tip: run `node discover.mjs` first to populate the database.');
    return;
  }

  console.log(`Generating messages for ${influencers.length} influencer(s)...\n`);

  let generated = 0;

  for (const influencer of influencers) {
    if (allVariations) {
      // Generate all template variations
      const variations = generateAllVariations(influencer);
      for (const result of variations) {
        printMessage(result, influencer);

        if (!preview) {
          interactionsDb.interactions.push({
            influencerId: influencer.id,
            type: 'outreach_generated',
            templateId: result.templateId,
            message: result.message,
            timestamp: result.generatedAt,
            sent: false,
          });
        }
        generated++;
      }
    } else {
      // Single template
      let tid = templateId;
      if (!tid && bestFit) {
        tid = pickBestTemplate(influencer);
      }
      if (!tid) {
        tid = 'fan_first';
      }

      const result = generateMessage(influencer, tid);
      printMessage(result, influencer);

      if (!preview) {
        interactionsDb.interactions.push({
          influencerId: influencer.id,
          type: 'outreach_generated',
          templateId: result.templateId,
          message: result.message,
          timestamp: result.generatedAt,
          sent: false,
        });
      }
      generated++;
    }
  }

  if (!preview) {
    saveInteractions(interactionsDb);
    console.log(`\nSaved ${generated} message(s) to interactions database.`);
  } else {
    console.log(`\n[PREVIEW MODE] ${generated} message(s) shown. Nothing saved.`);
  }
}

main().catch(console.error);
