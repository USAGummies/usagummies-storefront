#!/usr/bin/env node
// ============================================================================
// USA Gummies — Content Calendar Generator
// Generates a posting schedule with category rotation, holiday awareness,
// and platform optimization.
//
// Usage:
//   node calendar.mjs                             # next 30 days
//   node calendar.mjs --days 14                   # next 14 days
//   node calendar.mjs --start 2026-03-01 --days 60
//   node calendar.mjs --month 7                   # July (current year)
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, POSTING_SCHEDULE, PLATFORMS, OUTPUT_DIR } from './config.mjs';
import { SCRIPTS_DB, SCRIPTS_BY_CATEGORY } from './scripts-db.mjs';
import { SEASONAL_HASHTAGS, getHashtagsForCategory } from './hashtags.mjs';

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const daysCount = getArg('--days') ? parseInt(getArg('--days'), 10) : 30;
const startDateStr = getArg('--start');
const monthNum = getArg('--month') ? parseInt(getArg('--month'), 10) : null;

let startDate;
if (monthNum) {
  const year = new Date().getFullYear();
  startDate = new Date(year, monthNum - 1, 1);
} else if (startDateStr) {
  startDate = new Date(startDateStr + 'T00:00:00');
} else {
  startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// Holiday / Event Database
// ---------------------------------------------------------------------------
const HOLIDAYS = [
  { name: "New Year's Day", month: 1, day: 1 },
  { name: 'MLK Day', month: 1, day: 20, floating: true },
  { name: "Valentine's Day", month: 2, day: 14 },
  { name: "Presidents' Day", month: 2, day: 17, floating: true },
  { name: "St. Patrick's Day", month: 3, day: 17 },
  { name: 'Easter', month: 4, day: 20, floating: true, note: 'Date varies — update yearly' },
  { name: "Mother's Day", month: 5, day: 11, floating: true },
  { name: 'Memorial Day', month: 5, day: 26, floating: true },
  { name: "Father's Day", month: 6, day: 15, floating: true },
  { name: 'Independence Day', month: 7, day: 4 },
  { name: 'Labor Day', month: 9, day: 1, floating: true },
  { name: 'Halloween', month: 10, day: 31 },
  { name: 'Veterans Day', month: 11, day: 11 },
  { name: 'Thanksgiving', month: 11, day: 27, floating: true },
  { name: 'Christmas', month: 12, day: 25 },
];

// Content-relevant events (not strict holidays but good hooks)
const EVENTS = [
  { name: 'National Candy Day', month: 11, day: 4 },
  { name: 'National Gummy Bear Day', month: 4, day: 27 },
  { name: 'Back to School Season Start', month: 8, day: 1, range: true },
  { name: 'Summer Kickoff', month: 6, day: 1, range: true },
  { name: 'National Snack Day', month: 3, day: 4 },
  { name: 'Made in America Month', month: 10, day: 1, range: true },
];

function getHolidayForDate(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const found = [...HOLIDAYS, ...EVENTS].filter((h) => h.month === m && h.day === d);
  return found.length > 0 ? found : null;
}

function getNearbyHoliday(date, windowDays = 3) {
  const results = [];
  for (let i = -windowDays; i <= windowDays; i++) {
    const check = new Date(date);
    check.setDate(check.getDate() + i);
    const holidays = getHolidayForDate(check);
    if (holidays) {
      holidays.forEach((h) => {
        results.push({ ...h, daysAway: i, date: new Date(check) });
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Category Rotation Logic
// ---------------------------------------------------------------------------
const CATEGORY_ROTATION = [
  CATEGORIES.INGREDIENT_EXPOSE.id,  // Mon AM
  CATEGORIES.PARENT_HEALTH.id,       // Mon PM
  CATEGORIES.MADE_IN_USA.id,         // Tue AM
  CATEGORIES.COMPARISON.id,          // Tue PM
  CATEGORIES.PARENT_HEALTH.id,       // Wed AM
  CATEGORIES.INGREDIENT_EXPOSE.id,   // Wed PM
  CATEGORIES.STORYTELLING.id,        // Thu AM
  CATEGORIES.COMPARISON.id,          // Thu PM
  CATEGORIES.MADE_IN_USA.id,         // Fri AM
  CATEGORIES.TRENDING.id,            // Fri PM
  CATEGORIES.STORYTELLING.id,        // Sat AM
  CATEGORIES.MADE_IN_USA.id,         // Sat PM
  CATEGORIES.PARENT_HEALTH.id,       // Sun AM
  CATEGORIES.STORYTELLING.id,        // Sun PM
];

function getCategoryForSlot(dayOfWeek, slot) {
  // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
  // slot: 0=morning, 1=evening
  // Map to rotation index
  const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0, ..., Sun=6
  const idx = (dayIndex * 2 + slot) % CATEGORY_ROTATION.length;
  return CATEGORY_ROTATION[idx];
}

// Ensure no two consecutive posts are the same category
function adjustForConsecutive(schedule) {
  for (let i = 1; i < schedule.length; i++) {
    if (schedule[i].category === schedule[i - 1].category) {
      // Swap to a different category
      const alternatives = Object.values(CATEGORIES)
        .map((c) => c.id)
        .filter((id) => id !== schedule[i].category && id !== schedule[i - 1].category);
      if (alternatives.length > 0) {
        schedule[i].category = alternatives[Math.floor(Math.random() * alternatives.length)];
      }
    }
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Pick a script for a given category
// ---------------------------------------------------------------------------
const usedScripts = new Set();

function pickScript(categoryId) {
  const pool = SCRIPTS_BY_CATEGORY[categoryId] || [];
  const available = pool.filter((s) => !usedScripts.has(s.id) && !s.isTemplate);

  if (available.length === 0) {
    // Reset used scripts for this category and try again
    pool.forEach((s) => usedScripts.delete(s.id));
    const retryPool = pool.filter((s) => !s.isTemplate);
    if (retryPool.length === 0) return null;
    const pick = retryPool[Math.floor(Math.random() * retryPool.length)];
    usedScripts.add(pick.id);
    return pick;
  }

  const pick = available[Math.floor(Math.random() * available.length)];
  usedScripts.add(pick.id);
  return pick;
}

// ---------------------------------------------------------------------------
// Best Posting Times
// ---------------------------------------------------------------------------
const BEST_TIMES = {
  tiktok: { morning: '7:00-9:00 AM ET', evening: '5:00-7:00 PM ET' },
  reels: { morning: '8:00-10:00 AM ET', evening: '6:00-8:00 PM ET' },
  shorts: { morning: '9:00-11:00 AM ET', evening: '7:00-9:00 PM ET' },
};

// ---------------------------------------------------------------------------
// Generate Calendar
// ---------------------------------------------------------------------------
function generateCalendar() {
  const schedule = [];

  for (let d = 0; d < daysCount; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);

    const dayOfWeek = date.getDay();
    const dateStr = date.toISOString().slice(0, 10);
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];

    const holidays = getHolidayForDate(date);
    const nearbyHolidays = getNearbyHoliday(date);

    // Two slots per day
    for (let slot = 0; slot < POSTING_SCHEDULE.postsPerDay; slot++) {
      const slotName = slot === 0 ? 'morning' : 'evening';
      let category = getCategoryForSlot(dayOfWeek, slot);

      // Override for holidays — patriotic content
      if (holidays) {
        const patrioticHolidays = ['Independence Day', 'Memorial Day', 'Veterans Day', "Presidents' Day", 'Labor Day'];
        if (holidays.some((h) => patrioticHolidays.includes(h.name))) {
          category = CATEGORIES.MADE_IN_USA.id;
        }
      }

      // Near a holiday? Use trending/reactive
      if (!holidays && nearbyHolidays.length > 0 && slot === 1) {
        category = CATEGORIES.TRENDING.id;
      }

      const script = pickScript(category);
      const catMeta = Object.values(CATEGORIES).find((c) => c.id === category);

      let hashtags = [];
      try {
        hashtags = getHashtagsForCategory(category);
      } catch {
        hashtags = ['#USAGummies', '#MadeInUSA'];
      }

      schedule.push({
        date: dateStr,
        day: dayName,
        slot: slotName,
        time: POSTING_SCHEDULE.slots[slotName].label,
        category,
        categoryName: catMeta ? catMeta.name : category,
        scriptId: script ? script.id : null,
        scriptTitle: script ? script.title : '[Pick from pool]',
        hook: script ? script.hook : '[Custom hook needed]',
        estimatedDuration: script ? script.estimatedDuration : 30,
        platforms: script ? script.platforms : ['tiktok', 'reels', 'shorts'],
        hashtags,
        holiday: holidays ? holidays.map((h) => h.name).join(', ') : null,
        nearbyHoliday: nearbyHolidays.length > 0 ? nearbyHolidays.map((h) => `${h.name} (${h.daysAway > 0 ? '+' : ''}${h.daysAway}d)`).join(', ') : null,
        status: 'Not Started',
      });
    }
  }

  return adjustForConsecutive(schedule);
}

// ---------------------------------------------------------------------------
// Format to Markdown
// ---------------------------------------------------------------------------
function calendarToMarkdown(schedule) {
  const lines = [];
  lines.push('# USA Gummies — Content Calendar');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${schedule[0].date} to ${schedule[schedule.length - 1].date}`);
  lines.push(`Total Posts: ${schedule.length}`);
  lines.push('');

  // Best posting times reference
  lines.push('## Best Posting Times');
  lines.push('');
  lines.push('| Platform | Morning | Evening |');
  lines.push('|----------|---------|---------|');
  for (const [platform, times] of Object.entries(BEST_TIMES)) {
    const pm = PLATFORMS[platform];
    lines.push(`| ${pm ? pm.name : platform} | ${times.morning} | ${times.evening} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Calendar by day
  let currentDate = '';
  for (const entry of schedule) {
    if (entry.date !== currentDate) {
      currentDate = entry.date;
      lines.push(`## ${entry.day}, ${entry.date}`);
      if (entry.holiday) {
        lines.push(`**HOLIDAY: ${entry.holiday}**`);
      }
      if (entry.nearbyHoliday) {
        lines.push(`*Near: ${entry.nearbyHoliday}*`);
      }
      lines.push('');
    }

    const platformStr = entry.platforms
      .map((p) => { const pm = PLATFORMS[p]; return pm ? pm.name : p; })
      .join(', ');

    lines.push(`### ${entry.slot === 'morning' ? 'AM' : 'PM'} — ${entry.time}`);
    lines.push('');
    lines.push(`- **Category:** ${entry.categoryName}`);
    lines.push(`- **Script:** ${entry.scriptTitle}`);
    lines.push(`- **Hook:** "${entry.hook}"`);
    lines.push(`- **Duration:** ~${entry.estimatedDuration}s`);
    lines.push(`- **Platforms:** ${platformStr}`);
    lines.push(`- **Hashtags:** ${entry.hashtags.join(' ')}`);
    lines.push(`- **Status:** ${entry.status}`);
    lines.push('');
  }

  // Category distribution summary
  lines.push('---');
  lines.push('## Category Distribution');
  lines.push('');
  const catCounts = {};
  for (const e of schedule) {
    catCounts[e.categoryName] = (catCounts[e.categoryName] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / schedule.length) * 100).toFixed(1);
    lines.push(`- **${cat}:** ${count} posts (${pct}%)`);
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const schedule = generateCalendar();

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const ts = startDate.toISOString().slice(0, 10);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + daysCount - 1);
  const endTs = endDate.toISOString().slice(0, 10);

  // Markdown
  const md = calendarToMarkdown(schedule);
  const mdPath = join(OUTPUT_DIR, `calendar-${ts}-to-${endTs}.md`);
  writeFileSync(mdPath, md, 'utf-8');
  console.log(`Calendar MD:   ${mdPath}`);

  // JSON
  const jsonPath = join(OUTPUT_DIR, `calendar-${ts}-to-${endTs}.json`);
  writeFileSync(jsonPath, JSON.stringify(schedule, null, 2), 'utf-8');
  console.log(`Calendar JSON: ${jsonPath}`);

  // Summary
  console.log('');
  console.log(`Period: ${ts} to ${endTs} (${daysCount} days)`);
  console.log(`Total posts: ${schedule.length}`);
  console.log(`Posts per day: ${POSTING_SCHEDULE.postsPerDay}`);

  const catCounts = {};
  for (const e of schedule) {
    catCounts[e.categoryName] = (catCounts[e.categoryName] || 0) + 1;
  }
  console.log('Category mix:');
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
}

main();
