#!/usr/bin/env node
// ============================================================================
// USA Gummies — Follow-Up Sequence Generator
// ============================================================================
//
// Scans the influencer database and generates appropriate follow-up messages
// based on each influencer's current pipeline stage and time since last action.
//
// Usage:
//   node followup.mjs                        # show all due follow-ups
//   node followup.mjs --stage contacted      # only follow-ups for a specific stage
//   node followup.mjs --id <uuid>            # follow-up for one influencer
//   node followup.mjs --execute              # mark follow-ups as logged
//   node followup.mjs --type no_response_nudge  # specific follow-up type
//
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PATHS, FOLLOWUP_TIMING } from './config.mjs';
import {
  noResponseNudge,
  secondNudge,
  confirmShipping,
  trackingNotification,
  deliveryCheckin,
  thankYouForPost,
  softFollowupNoPost,
  ftcDisclosureReminder,
} from './templates/followup-templates.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = (f) => args.includes(f);

const stageFilter = getArg('--stage');
const idFilter = getArg('--id');
const typeFilter = getArg('--type');
const execute = hasFlag('--execute');

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

function saveInteractions(db) {
  db.lastUpdated = new Date().toISOString();
  writeFileSync(PATHS.interactionsDb, JSON.stringify(db, null, 2));
}

// ---------------------------------------------------------------------------
// Calculate days since a timestamp
// ---------------------------------------------------------------------------
function daysSince(isoTimestamp) {
  if (!isoTimestamp) return Infinity;
  const then = new Date(isoTimestamp);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Find the most recent interaction of a given type for an influencer
// ---------------------------------------------------------------------------
function lastInteractionOfType(interactions, influencerId, type) {
  return interactions
    .filter(i => i.influencerId === influencerId && i.type === type)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
}

// ---------------------------------------------------------------------------
// Find the most recent stage change for an influencer
// ---------------------------------------------------------------------------
function lastStageChange(interactions, influencerId) {
  return interactions
    .filter(i => i.influencerId === influencerId && i.type === 'stage_change')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
}

// ---------------------------------------------------------------------------
// Determine which follow-ups are due for an influencer
// ---------------------------------------------------------------------------
function getDueFollowups(influencer, interactions) {
  const due = [];
  const stage = influencer.stage;

  // Find when they entered the current stage
  const stageChange = lastStageChange(interactions, influencer.id);
  const stageTimestamp = stageChange?.timestamp || influencer.discoveredAt;
  const daysInStage = daysSince(stageTimestamp);

  // --- CONTACTED: nudge after 3 days ---
  if (stage === 'contacted') {
    const alreadyNudged = lastInteractionOfType(interactions, influencer.id, 'followup_no_response_nudge');

    if (!alreadyNudged && daysInStage >= FOLLOWUP_TIMING.noResponseNudge) {
      due.push({
        ...noResponseNudge(influencer),
        daysOverdue: daysInStage - FOLLOWUP_TIMING.noResponseNudge,
        urgency: 'normal',
      });
    }

    // Second nudge after 7 more days
    if (alreadyNudged) {
      const daysSinceNudge = daysSince(alreadyNudged.timestamp);
      const alreadySecondNudge = lastInteractionOfType(interactions, influencer.id, 'followup_second_nudge');

      if (!alreadySecondNudge && daysSinceNudge >= FOLLOWUP_TIMING.secondNudge) {
        due.push({
          ...secondNudge(influencer),
          daysOverdue: daysSinceNudge - FOLLOWUP_TIMING.secondNudge,
          urgency: 'low',
        });
      }
    }
  }

  // --- RESPONDED: confirm shipping immediately ---
  if (stage === 'responded') {
    const alreadyConfirmed = lastInteractionOfType(interactions, influencer.id, 'followup_confirm_shipping');
    if (!alreadyConfirmed) {
      due.push({
        ...confirmShipping(influencer),
        daysOverdue: daysInStage,
        urgency: 'high',
      });
    }
  }

  // --- PRODUCT_SENT: delivery check-in after 7 days ---
  if (stage === 'product_sent') {
    const alreadyCheckedIn = lastInteractionOfType(interactions, influencer.id, 'followup_delivery_checkin');

    if (!alreadyCheckedIn && daysInStage >= FOLLOWUP_TIMING.deliveryCheckin) {
      due.push({
        ...deliveryCheckin(influencer),
        daysOverdue: daysInStage - FOLLOWUP_TIMING.deliveryCheckin,
        urgency: 'normal',
      });
    }

    // Soft follow-up if no post after 14 days
    const alreadySoftFollowup = lastInteractionOfType(interactions, influencer.id, 'followup_soft_followup_no_post');
    if (!alreadySoftFollowup && daysInStage >= FOLLOWUP_TIMING.softFollowupNoPost) {
      due.push({
        ...softFollowupNoPost(influencer),
        daysOverdue: daysInStage - FOLLOWUP_TIMING.softFollowupNoPost,
        urgency: 'low',
      });
    }
  }

  // --- POSTED: thank you ---
  if (stage === 'posted') {
    const alreadyThanked = lastInteractionOfType(interactions, influencer.id, 'followup_thank_you_post');
    if (!alreadyThanked) {
      due.push({
        ...thankYouForPost(influencer),
        daysOverdue: daysInStage,
        urgency: 'high',
      });
    }

    // FTC disclosure check
    if (influencer.ftcDisclosed === false || influencer.ftcDisclosed === null) {
      const alreadyReminded = lastInteractionOfType(interactions, influencer.id, 'followup_ftc_disclosure_reminder');
      if (!alreadyReminded) {
        due.push({
          ...ftcDisclosureReminder(influencer),
          daysOverdue: daysInStage,
          urgency: 'normal',
        });
      }
    }
  }

  return due;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log('=== USA Gummies Follow-Up Sequence Generator ===\n');

  const db = loadInfluencers();
  const idb = loadInteractions();

  let influencers = db.influencers;

  if (idFilter) {
    influencers = influencers.filter(i => i.id === idFilter);
  }
  if (stageFilter) {
    influencers = influencers.filter(i => i.stage === stageFilter);
  }

  // Only check actionable stages
  const actionableStages = ['contacted', 'responded', 'product_sent', 'posted'];
  if (!stageFilter && !idFilter) {
    influencers = influencers.filter(i => actionableStages.includes(i.stage));
  }

  if (influencers.length === 0) {
    console.log('No influencers in actionable stages.');
    return;
  }

  let totalDue = 0;

  for (const influencer of influencers) {
    let dueFollowups = getDueFollowups(influencer, idb.interactions);

    if (typeFilter) {
      dueFollowups = dueFollowups.filter(f => f.id === typeFilter);
    }

    if (dueFollowups.length === 0) continue;

    totalDue += dueFollowups.length;

    for (const followup of dueFollowups) {
      const urgencyIcon = followup.urgency === 'high' ? '[!!]' : followup.urgency === 'normal' ? '[!]' : '[~]';

      console.log(`${urgencyIcon} @${influencer.username} (${influencer.platform}) — ${followup.label}`);
      console.log(`   Stage: ${influencer.stage} | Days overdue: ${followup.daysOverdue}`);
      console.log(`   ---`);
      console.log(`   ${followup.message}`);
      console.log('');

      if (execute) {
        idb.interactions.push({
          influencerId: influencer.id,
          type: `followup_${followup.id}`,
          message: followup.message,
          timestamp: new Date().toISOString(),
          sent: false, // mark true after actually sending
        });
      }
    }
  }

  if (execute && totalDue > 0) {
    saveInteractions(idb);
    console.log(`\nLogged ${totalDue} follow-up(s) to interactions database.`);
    console.log('Remember to actually send the messages and mark them as sent!');
  } else if (totalDue === 0) {
    console.log('No follow-ups are due right now. All caught up!');
  } else {
    console.log(`\n${totalDue} follow-up(s) due. Use --execute to log them.`);
  }
}

main();
