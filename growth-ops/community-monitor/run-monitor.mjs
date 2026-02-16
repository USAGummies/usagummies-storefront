#!/usr/bin/env node
// =============================================================================
// USA Gummies — Community Monitor Orchestrator
//
// Runs the full monitoring pipeline:
//   1. Reddit monitor — scan subreddits for matching posts
//   2. Keyword tracker — track competitors + trending keywords
//   3. Response generator — generate AI response templates for new matches
//
// Usage:
//   node run-monitor.mjs                     Run full pipeline
//   node run-monitor.mjs --reddit-only       Only run Reddit monitor
//   node run-monitor.mjs --keywords-only     Only run keyword tracker
//   node run-monitor.mjs --responses-only    Only run response generator
//   node run-monitor.mjs --dry-run           Dry run all steps
//   node run-monitor.mjs --skip-responses    Skip response generation
//   node run-monitor.mjs --limit 5           Limit response generation to 5 posts
//
// Schedule via launchd or cron for automated monitoring.
// =============================================================================

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { PATHS } from './config.mjs';
import { runRedditMonitor } from './reddit-monitor.mjs';
import { runKeywordTracker } from './keyword-tracker.mjs';
import { runResponseGenerator } from './generate-responses.mjs';

// ---------------------------------------------------------------------------
// Logging — writes to both console and log file
// ---------------------------------------------------------------------------

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);

  try {
    ensureDir(PATHS.runLog);
    appendFileSync(PATHS.runLog, line + '\n');
  } catch {
    // Silently ignore log write failures
  }
}

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------

function parseFlags() {
  const args = process.argv.slice(2);
  return {
    redditOnly: args.includes('--reddit-only'),
    keywordsOnly: args.includes('--keywords-only'),
    responsesOnly: args.includes('--responses-only'),
    skipResponses: args.includes('--skip-responses'),
    dryRun: args.includes('--dry-run'),
    limit: (() => {
      const idx = args.indexOf('--limit');
      return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : undefined;
    })(),
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseFlags();
  const startTime = Date.now();

  log('');
  log('================================================================');
  log('  USA Gummies Community Monitor');
  log('================================================================');
  log(`Run mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (flags.redditOnly) log('Scope: Reddit monitor only');
  else if (flags.keywordsOnly) log('Scope: Keyword tracker only');
  else if (flags.responsesOnly) log('Scope: Response generator only');
  else log('Scope: Full pipeline');
  log('');

  const results = {
    reddit: null,
    keywords: null,
    responses: null,
    errors: [],
  };

  // -----------------------------------------------------------------------
  // Step 1: Reddit Monitor
  // -----------------------------------------------------------------------
  if (!flags.keywordsOnly && !flags.responsesOnly) {
    log('--- STEP 1: Reddit Monitor ---');
    try {
      results.reddit = await runRedditMonitor();
      log(`Reddit: ${results.reddit.total} matches, ${results.reddit.new} new`);
    } catch (err) {
      log(`Reddit monitor FAILED: ${err.message}`);
      results.errors.push({ step: 'reddit', error: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Keyword Tracker
  // -----------------------------------------------------------------------
  if (!flags.redditOnly && !flags.responsesOnly) {
    log('--- STEP 2: Keyword Tracker ---');
    try {
      results.keywords = await runKeywordTracker();
      log(`Keywords: ${results.keywords.competitor_complaints.total_mentions} competitor mentions`);
      log(`Keywords: ${results.keywords.trending_keywords.total_posts} trending posts`);
    } catch (err) {
      log(`Keyword tracker FAILED: ${err.message}`);
      results.errors.push({ step: 'keywords', error: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Response Generator
  // -----------------------------------------------------------------------
  if (!flags.redditOnly && !flags.keywordsOnly && !flags.skipResponses) {
    log('--- STEP 3: Response Generator ---');

    // Only run if we have matches to process
    if (existsSync(PATHS.redditMatches)) {
      try {
        results.responses = await runResponseGenerator({
          dryRun: flags.dryRun,
          limit: flags.limit,
        });
        log(`Responses: ${results.responses.generated} generated`);
      } catch (err) {
        log(`Response generator FAILED: ${err.message}`);
        results.errors.push({ step: 'responses', error: err.message });
      }
    } else {
      log('No Reddit matches file found — skipping response generation');
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log('');
  log('================================================================');
  log('  Run Summary');
  log('================================================================');
  log(`Total runtime: ${elapsed}s`);

  if (results.reddit) {
    log(`Reddit: ${results.reddit.total} matches (${results.reddit.new} new)`);
  }
  if (results.keywords) {
    log(`Competitor mentions: ${results.keywords.competitor_complaints.total_mentions}`);
    log(`Trending keyword posts: ${results.keywords.trending_keywords.total_posts}`);
  }
  if (results.responses) {
    log(`Responses generated: ${results.responses.generated}`);
    if (results.responses.errors) {
      log(`Response errors: ${results.responses.errors}`);
    }
  }
  if (results.errors.length > 0) {
    log(`\nERRORS (${results.errors.length}):`);
    for (const e of results.errors) {
      log(`  - ${e.step}: ${e.error}`);
    }
  }

  log('================================================================');
  log('');

  // Exit with error code if any step failed critically
  if (results.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  console.error(err);
  process.exit(1);
});
