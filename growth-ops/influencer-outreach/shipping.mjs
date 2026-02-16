#!/usr/bin/env node
// ============================================================================
// USA Gummies — Shipping Label & Packing Slip Generator
// ============================================================================
//
// Usage:
//   node shipping.mjs label <id>                      # generate shipping label
//   node shipping.mjs label <id> --tracking "1Z..."   # with tracking number
//   node shipping.mjs slip <id>                       # generate packing slip
//   node shipping.mjs ship <id> --tracking "1Z..."    # label + slip + update CRM
//   node shipping.mjs list-ready                      # list influencers ready to ship
//   node shipping.mjs batch                           # generate labels for all ready
//
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PATHS, BRAND, PRODUCT_TIERS, DEFAULT_TIER, FTC } from './config.mjs';

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

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function loadInfluencers() {
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

function findInfluencer(id) {
  const db = loadInfluencers();
  const inf = db.influencers.find(i => i.id === id);
  if (!inf) {
    console.error(`Influencer not found: ${id}`);
    process.exit(1);
  }
  return { db, inf };
}

// ---------------------------------------------------------------------------
// Shipping label (text format)
// ---------------------------------------------------------------------------
function generateLabel(influencer, trackingNumber) {
  const from = BRAND.shippingFrom;
  const tier = PRODUCT_TIERS[influencer.productTier || DEFAULT_TIER];

  const label = `
${'='.repeat(60)}
                    SHIPPING LABEL
${'='.repeat(60)}

FROM:
  ${from.name}
  ${from.address1 || '[Address Line 1]'}
  ${from.city || '[City]'}, ${from.state || '[ST]'} ${from.zip || '[ZIP]'}
  ${from.country}

TO:
  ${influencer.firstName || influencer.username}
  ${influencer.shippingAddress || '[ADDRESS NOT SET -- update with crm.mjs]'}

${'─'.repeat(60)}
CONTENTS:  ${tier.label} - ${BRAND.productName}
WEIGHT:    ~${tier.bags * 0.5} lbs (estimated)
VALUE:     Gift / Sample (no commercial value)
${trackingNumber ? `TRACKING:  ${trackingNumber}` : 'TRACKING:  [not yet assigned]'}
${'─'.repeat(60)}
DATE:      ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
${'='.repeat(60)}
`;

  return label;
}

// ---------------------------------------------------------------------------
// Packing slip with personal note
// ---------------------------------------------------------------------------
function generatePackingSlip(influencer) {
  const tier = PRODUCT_TIERS[influencer.productTier || DEFAULT_TIER];
  const name = influencer.firstName || influencer.username;

  const slip = `
${'='.repeat(60)}
                    PACKING SLIP
                    ${BRAND.name}
${'='.repeat(60)}

Hey ${name}!

Here's your ${BRAND.productName}. Made in the USA with
zero artificial dyes. Hope you love them!

-- The ${BRAND.name} Team

${'─'.repeat(60)}
ORDER DETAILS:
  Item:      ${tier.label} - ${BRAND.productName}
  Quantity:  ${tier.bags} bag(s)
  Price:     COMPLIMENTARY (gifted)
  Date:      ${new Date().toLocaleDateString('en-US')}

${'─'.repeat(60)}
CONNECT WITH US:
  Website:   ${BRAND.website}
  Instagram: ${BRAND.instagram}
  TikTok:    ${BRAND.tiktok}
  Email:     ${BRAND.email}

${'─'.repeat(60)}
FTC DISCLOSURE NOTE:

${FTC.packingSlipDisclosureNote}

Suggested hashtags: ${FTC.requiredDisclosures.join('  ')}
${'='.repeat(60)}
`;

  return slip;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function cmdLabel() {
  const id = args[1];
  if (!id) {
    console.error('Usage: node shipping.mjs label <influencer-id> [--tracking "..."]');
    process.exit(1);
  }

  const { inf } = findInfluencer(id);
  const tracking = getArg('--tracking');
  const label = generateLabel(inf, tracking);

  console.log(label);

  // Save to file
  const outDir = join(PATHS.dataDir, 'shipping-labels');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `label-${inf.username}-${Date.now()}.txt`);
  writeFileSync(outPath, label);
  console.log(`Saved to: ${outPath}`);
}

function cmdSlip() {
  const id = args[1];
  if (!id) {
    console.error('Usage: node shipping.mjs slip <influencer-id>');
    process.exit(1);
  }

  const { inf } = findInfluencer(id);
  const slip = generatePackingSlip(inf);

  console.log(slip);

  // Save to file
  const outDir = join(PATHS.dataDir, 'packing-slips');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `slip-${inf.username}-${Date.now()}.txt`);
  writeFileSync(outPath, slip);
  console.log(`Saved to: ${outPath}`);
}

function cmdShip() {
  const id = args[1];
  const tracking = getArg('--tracking');

  if (!id) {
    console.error('Usage: node shipping.mjs ship <influencer-id> --tracking "..."');
    process.exit(1);
  }

  const { db, inf } = findInfluencer(id);

  if (!inf.shippingAddress) {
    console.error(`No shipping address for @${inf.username}. Update with:`);
    console.error(`  node crm.mjs update ${id} --address "123 Main St, City, ST 12345"`);
    process.exit(1);
  }

  // Generate label
  const label = generateLabel(inf, tracking);
  console.log(label);

  // Generate packing slip
  const slip = generatePackingSlip(inf);
  console.log(slip);

  // Update CRM
  inf.stage = 'product_sent';
  if (tracking) inf.trackingNumber = tracking;
  if (!inf.productTier) inf.productTier = DEFAULT_TIER;
  saveInfluencers(db);

  // Log interaction
  const idb = loadInteractions();
  idb.interactions.push({
    influencerId: id,
    type: 'product_shipped',
    trackingNumber: tracking || null,
    productTier: inf.productTier,
    timestamp: new Date().toISOString(),
  });
  saveInteractions(idb);

  // Save files
  const labelDir = join(PATHS.dataDir, 'shipping-labels');
  const slipDir = join(PATHS.dataDir, 'packing-slips');
  if (!existsSync(labelDir)) mkdirSync(labelDir, { recursive: true });
  if (!existsSync(slipDir)) mkdirSync(slipDir, { recursive: true });

  writeFileSync(join(labelDir, `label-${inf.username}-${Date.now()}.txt`), label);
  writeFileSync(join(slipDir, `slip-${inf.username}-${Date.now()}.txt`), slip);

  console.log(`\nShipment recorded for @${inf.username}`);
  console.log(`Stage updated to: product_sent`);
  if (tracking) console.log(`Tracking: ${tracking}`);
}

function cmdListReady() {
  const db = loadInfluencers();
  const ready = db.influencers.filter(i =>
    i.stage === 'responded' && i.shippingAddress
  );

  const needAddress = db.influencers.filter(i =>
    i.stage === 'responded' && !i.shippingAddress
  );

  console.log('\n=== Ready to Ship ===\n');

  if (ready.length === 0 && needAddress.length === 0) {
    console.log('No influencers are in the "responded" stage.');
    return;
  }

  if (ready.length > 0) {
    console.log(`Ready (${ready.length}):`);
    for (const inf of ready) {
      const tier = PRODUCT_TIERS[inf.productTier || DEFAULT_TIER];
      console.log(`  @${inf.username.padEnd(25)} ${tier.label.padEnd(15)} ${inf.shippingAddress}`);
      console.log(`  ${''.padEnd(25)} id: ${inf.id}`);
    }
  }

  if (needAddress.length > 0) {
    console.log(`\nNeed address (${needAddress.length}):`);
    for (const inf of needAddress) {
      console.log(`  @${inf.username.padEnd(25)} [no address yet]`);
      console.log(`  ${''.padEnd(25)} id: ${inf.id}`);
    }
  }

  console.log('');
}

function cmdBatch() {
  const db = loadInfluencers();
  const ready = db.influencers.filter(i =>
    i.stage === 'responded' && i.shippingAddress
  );

  if (ready.length === 0) {
    console.log('No influencers are ready to ship (need "responded" stage + shipping address).');
    return;
  }

  console.log(`\n=== Batch Shipping Labels (${ready.length}) ===\n`);

  const labelDir = join(PATHS.dataDir, 'shipping-labels');
  const slipDir = join(PATHS.dataDir, 'packing-slips');
  if (!existsSync(labelDir)) mkdirSync(labelDir, { recursive: true });
  if (!existsSync(slipDir)) mkdirSync(slipDir, { recursive: true });

  for (const inf of ready) {
    const label = generateLabel(inf, null);
    const slip = generatePackingSlip(inf);

    writeFileSync(join(labelDir, `label-${inf.username}-${Date.now()}.txt`), label);
    writeFileSync(join(slipDir, `slip-${inf.username}-${Date.now()}.txt`), slip);

    console.log(`  Generated: @${inf.username}`);
  }

  console.log(`\nLabels saved to: ${labelDir}`);
  console.log(`Slips saved to:  ${slipDir}`);
  console.log('\nTo mark as shipped with tracking, run:');
  console.log('  node shipping.mjs ship <id> --tracking "..."');
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function showHelp() {
  console.log(`
USA Gummies Shipping Manager

Commands:
  label <id>          Generate a shipping label
  slip <id>           Generate a packing slip
  ship <id>           Generate label + slip + update CRM
  list-ready          List influencers ready to ship
  batch               Generate labels for all ready

Options:
  --tracking "..."    Set tracking number
  `);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
switch (command) {
  case 'label':      cmdLabel(); break;
  case 'slip':       cmdSlip(); break;
  case 'ship':       cmdShip(); break;
  case 'list-ready': cmdListReady(); break;
  case 'batch':      cmdBatch(); break;
  default:           showHelp();
}
