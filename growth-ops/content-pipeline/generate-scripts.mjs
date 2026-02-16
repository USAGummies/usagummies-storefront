#!/usr/bin/env node
// ============================================================================
// USA Gummies — Script Generator
// Generates complete video scripts from the database
//
// Usage:
//   node generate-scripts.mjs                         # all scripts
//   node generate-scripts.mjs --category ingredient-expose
//   node generate-scripts.mjs --category made-in-usa --count 5
//   node generate-scripts.mjs --random 10
//   node generate-scripts.mjs --competitor haribo
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS_DB, SCRIPTS_BY_CATEGORY, getStats } from './scripts-db.mjs';
import { BRAND, CATEGORIES, PLATFORMS, CTA_OPTIONS, OUTPUT_DIR } from './config.mjs';
import { getHashtagsForCategory } from './hashtags.mjs';

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

const categoryFilter = getArg('--category');
const countLimit = getArg('--count') ? parseInt(getArg('--count'), 10) : null;
const randomCount = getArg('--random') ? parseInt(getArg('--random'), 10) : null;
const competitorFilter = getArg('--competitor');
const showHelp = hasFlag('--help') || hasFlag('-h');

if (showHelp) {
  console.log(`
USA Gummies — Script Generator

Usage:
  node generate-scripts.mjs [options]

Options:
  --category <id>       Filter by category ID:
                          ingredient-expose, made-in-usa, parent-health,
                          comparison, trending, storytelling
  --count <n>           Limit number of scripts output
  --random <n>          Pick n random scripts from the database
  --competitor <key>    Filter by competitor: haribo, trolli, sourPatchKids,
                          skittlesGummies, nerdsGummyClusters, brachs, airheads
  --help, -h            Show this help message

Examples:
  node generate-scripts.mjs --category ingredient-expose
  node generate-scripts.mjs --category made-in-usa --count 5
  node generate-scripts.mjs --random 10
  node generate-scripts.mjs --competitor haribo
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Filter Scripts
// ---------------------------------------------------------------------------
function filterScripts() {
  let scripts = [...SCRIPTS_DB];

  if (categoryFilter) {
    scripts = scripts.filter((s) => s.category === categoryFilter);
    if (scripts.length === 0) {
      console.error(`No scripts found for category: ${categoryFilter}`);
      console.error(`Valid categories: ${Object.values(CATEGORIES).map((c) => c.id).join(', ')}`);
      process.exit(1);
    }
  }

  if (competitorFilter) {
    scripts = scripts.filter((s) => s.competitor === competitorFilter);
    if (scripts.length === 0) {
      console.error(`No scripts found for competitor: ${competitorFilter}`);
      process.exit(1);
    }
  }

  if (randomCount) {
    scripts = shuffleArray(scripts).slice(0, randomCount);
  } else if (countLimit) {
    scripts = scripts.slice(0, countLimit);
  }

  return scripts;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Format a single script to Markdown
// ---------------------------------------------------------------------------
function scriptToMarkdown(script, index) {
  const catMeta = Object.values(CATEGORIES).find((c) => c.id === script.category);
  const catName = catMeta ? catMeta.name : script.category;

  let hashtags = [];
  try {
    hashtags = getHashtagsForCategory(script.category);
  } catch {
    hashtags = ['#USAGummies', '#MadeInUSA', '#DyeFreeCandy'];
  }

  const platformList = (script.platforms || ['tiktok', 'reels', 'shorts'])
    .map((p) => {
      const pm = PLATFORMS[p];
      return pm ? pm.name : p;
    })
    .join(', ');

  const lines = [];
  lines.push(`## Script ${index + 1}: ${script.title}`);
  lines.push('');
  lines.push(`**ID:** \`${script.id}\``);
  lines.push(`**Category:** ${catName}`);
  if (script.competitor) {
    lines.push(`**Competitor:** ${script.competitor}`);
  }
  lines.push(`**Est. Duration:** ${script.estimatedDuration}s`);
  lines.push(`**Platforms:** ${platformList}`);
  if (script.isTemplate) {
    lines.push(`**Template:** Yes — fill in: ${(script.fillIn || []).join(', ')}`);
  }
  lines.push('');

  // Hook
  lines.push('### Hook (First 3 Seconds)');
  lines.push('');
  lines.push(`> ${script.hook}`);
  lines.push('');

  // Body
  lines.push('### Body');
  lines.push('');
  script.body.forEach((line) => {
    lines.push(`- ${line}`);
  });
  lines.push('');

  // CTA
  lines.push('### CTA');
  lines.push('');
  lines.push(`> ${script.cta}`);
  lines.push('');

  // On-Screen Text
  if (script.onScreenText && script.onScreenText.length > 0) {
    lines.push('### On-Screen Text');
    lines.push('');
    script.onScreenText.forEach((t) => {
      lines.push(`- ${t}`);
    });
    lines.push('');
  }

  // Visual Notes
  if (script.visualNotes) {
    lines.push('### Visual / B-Roll Notes');
    lines.push('');
    lines.push(script.visualNotes);
    lines.push('');
  }

  // Platform Notes
  lines.push('### Platform Optimization');
  lines.push('');
  (script.platforms || ['tiktok', 'reels', 'shorts']).forEach((p) => {
    const pm = PLATFORMS[p];
    if (pm) {
      lines.push(`**${pm.name}:** ${pm.notes}`);
      lines.push('');
    }
  });

  // Hashtags
  lines.push('### Hashtags');
  lines.push('');
  lines.push(hashtags.join(' '));
  lines.push('');

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Format scripts to JSON output
// ---------------------------------------------------------------------------
function scriptsToJSON(scripts) {
  return scripts.map((s) => {
    let hashtags = [];
    try {
      hashtags = getHashtagsForCategory(s.category);
    } catch {
      hashtags = ['#USAGummies', '#MadeInUSA', '#DyeFreeCandy'];
    }

    return {
      ...s,
      hashtags,
      brand: BRAND.name,
      generatedAt: new Date().toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const scripts = filterScripts();

  if (scripts.length === 0) {
    console.log('No scripts matched the given filters.');
    process.exit(0);
  }

  // Ensure output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Build timestamp for filenames
  const ts = new Date().toISOString().slice(0, 10);
  const suffix = categoryFilter || (competitorFilter ? `comp-${competitorFilter}` : 'all');

  // Markdown output
  const mdLines = [];
  mdLines.push(`# USA Gummies — Video Scripts`);
  mdLines.push('');
  mdLines.push(`Generated: ${new Date().toISOString()}`);
  mdLines.push(`Scripts: ${scripts.length}`);
  if (categoryFilter) mdLines.push(`Category: ${categoryFilter}`);
  if (competitorFilter) mdLines.push(`Competitor: ${competitorFilter}`);
  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');

  scripts.forEach((s, i) => {
    mdLines.push(scriptToMarkdown(s, i));
  });

  const mdPath = join(OUTPUT_DIR, `scripts-${suffix}-${ts}.md`);
  writeFileSync(mdPath, mdLines.join('\n'), 'utf-8');
  console.log(`Markdown: ${mdPath}`);

  // JSON output
  const jsonData = scriptsToJSON(scripts);
  const jsonPath = join(OUTPUT_DIR, `scripts-${suffix}-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log(`JSON:     ${jsonPath}`);

  // Stats
  const stats = getStats();
  console.log('');
  console.log('--- Script Database Stats ---');
  console.log(`Total scripts:      ${stats.total}`);
  console.log(`Ready to shoot:     ${stats.readyToShoot}`);
  console.log(`Templates (fill-in): ${stats.templates}`);
  console.log('By category:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
}

main();
