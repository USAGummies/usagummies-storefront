#!/usr/bin/env node
/**
 * overnight-worker.mjs — Automated overnight growth ops
 *
 * Runs on a schedule via launchd. Executes multiple growth tasks:
 *   1. Reddit monitor — scan 19 subreddits for new matching posts
 *   2. Keyword tracker — track competitor complaints + trending topics
 *   3. Content calendar — generate next 7 days of content ideas
 *   4. Morning scorecard — campaign performance KPIs via iMessage
 *
 * Schedule (via launchd):
 *   - 11:00 PM PT — Reddit scan #1 (catch evening posts)
 *   - 3:00 AM PT  — Reddit scan #2 (catch late-night/early AM)
 *   - 7:00 AM PT  — Morning scorecard text
 *
 * Usage:
 *   node scripts/overnight-worker.mjs              # Full run
 *   node scripts/overnight-worker.mjs --reddit     # Reddit scan only
 *   node scripts/overnight-worker.mjs --keywords   # Keyword track only
 *   node scripts/overnight-worker.mjs --summary    # Morning summary only
 *   node scripts/overnight-worker.mjs --calendar   # Content calendar only
 *
 * Logs: ~/Library/Logs/usagummies-overnight.log
 */

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MONITOR_DIR = path.join(PROJECT_ROOT, "growth-ops", "community-monitor");
const PIPELINE_DIR = path.join(PROJECT_ROOT, "growth-ops", "content-pipeline");
const DATA_DIR = path.join(MONITOR_DIR, "data");

// Phone numbers for iMessage summary
const PHONE_NUMBERS = ["4358967765", "6102356973"];

// Dye-free content pages to track (the campaign's content cluster)
const DYE_FREE_PAGES = [
  "/dye-free-movement",
  "/dye-free-candy",
  "/blog/artificial-dye-free-candy-snacks",
  "/blog/artificial-dyes-banned-in-europe-not-us",
  "/blog/best-dye-free-candy-brands",
  "/blog/dye-free-gummies-for-kids-parties",
  "/blog/dye-free-gummy-bears-ingredients",
  "/blog/dye-free-snacks-for-kids",
  "/blog/fda-red-no-3-ban-what-to-know",
  "/blog/is-red-40-bad-for-you",
  "/blog/mars-removing-artificial-dyes-what-it-means",
  "/blog/natural-color-candy-vs-artificial-dyes",
  "/blog/red-40-free-gummies-dye-free-meaning",
  "/blog/what-candy-has-red-40",
];

// ── Load env file (same as daily-report.mjs) ─────────────────────────────
const envPath = path.resolve(
  process.env.HOME || "/Users/ben",
  ".config/usa-gummies-mcp/.env-daily-report"
);
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────────
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "";
const GA4_SERVICE_ACCOUNT_PATH = path.resolve(
  process.env.HOME || "/Users/ben",
  ".config/usa-gummies-mcp/ga4-service-account.json"
);

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) return { all: true };
  return {
    reddit: args.includes("--reddit"),
    keywords: args.includes("--keywords"),
    summary: args.includes("--summary"),
    calendar: args.includes("--calendar"),
    all: false,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────
function pctChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? "+∞" : "—";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function arrow(current, previous) {
  if (current > previous) return "↑";
  if (current < previous) return "↓";
  return "→";
}

function dateRange(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [m, day, y] = d
    .toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    })
    .split("/");
  return `${y}-${m}-${day}`;
}

// ─── Reddit Monitor ──────────────────────────────────────────────────────
async function runRedditMonitor() {
  log("📡 Starting Reddit monitor scan...");
  try {
    const script = path.join(MONITOR_DIR, "reddit-monitor.mjs");
    if (!fs.existsSync(script)) {
      log("❌ reddit-monitor.mjs not found");
      return { success: false, newMatches: 0 };
    }

    const result = spawnSync("node", [script], {
      cwd: MONITOR_DIR,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: "/Users/ben" },
    });

    const output = (result.stdout || "") + (result.stderr || "");
    const newMatchLine = output.match(/New matches.*?:\s*(\d+)/);
    const totalLine = output.match(/Total in database:\s*(\d+)/);
    const newMatches = newMatchLine ? parseInt(newMatchLine[1], 10) : 0;
    const totalMatches = totalLine ? parseInt(totalLine[1], 10) : 0;

    log(`✅ Reddit scan: ${newMatches} new, ${totalMatches} total`);
    return { success: true, newMatches, totalMatches };
  } catch (err) {
    log(`❌ Reddit monitor error: ${err.message}`);
    return { success: false, newMatches: 0, error: err.message };
  }
}

// ─── Keyword Tracker ─────────────────────────────────────────────────────
async function runKeywordTracker() {
  log("🔍 Starting keyword tracker...");
  try {
    const script = path.join(MONITOR_DIR, "keyword-tracker.mjs");
    if (!fs.existsSync(script)) {
      log("⚠️  keyword-tracker.mjs not found, skipping");
      return { success: false };
    }

    const result = spawnSync("node", [script], {
      cwd: MONITOR_DIR,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME: "/Users/ben" },
    });

    if (result.status === 0) {
      log("✅ Keyword tracker complete");
      return { success: true };
    } else {
      log(`⚠️  Keyword tracker exited with code ${result.status}`);
      return { success: false };
    }
  } catch (err) {
    log(`❌ Keyword tracker error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Content Calendar ────────────────────────────────────────────────────
async function runContentCalendar() {
  log("📅 Generating content calendar (next 7 days)...");
  try {
    const script = path.join(PIPELINE_DIR, "calendar.mjs");
    if (!fs.existsSync(script)) {
      log("⚠️  calendar.mjs not found, skipping");
      return { success: false };
    }

    const result = spawnSync("node", [script, "--days", "7"], {
      cwd: PIPELINE_DIR,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, HOME: "/Users/ben" },
    });

    if (result.status === 0) {
      log("✅ Content calendar generated");
      return { success: true };
    } else {
      log(`⚠️  Calendar exited with code ${result.status}`);
      return { success: false };
    }
  } catch (err) {
    log(`❌ Calendar error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ─── GA4 Data — campaign traffic KPIs ───────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════
async function getGA4Client() {
  const { google } = await import("googleapis");

  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(GA4_SERVICE_ACCOUNT_PATH, "utf8"));
  } catch {
    log("❌ Could not read GA4 service account JSON");
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  return google.analyticsdata({ version: "v1beta", auth });
}

async function fetchTrafficKPIs() {
  if (!GA4_PROPERTY_ID) return null;

  const client = await getGA4Client();
  if (!client) return null;

  const today = dateRange(0);
  const yesterday = dateRange(1);
  const sevenDaysAgo = dateRange(7);
  const fourteenDaysAgo = dateRange(14);

  // Page path filter for the dye-free content cluster
  const dyeFreeFilter = {
    or_group: {
      expressions: DYE_FREE_PAGES.map((p) => ({
        filter: {
          field_name: "pagePath",
          string_filter: { match_type: "EXACT", value: p },
        },
      })),
    },
  };

  const [
    todayAll,
    yesterdayAll,
    thisWeekAll,
    prevWeekAll,
    todayDyeFree,
    thisWeekDyeFree,
    prevWeekDyeFree,
    todaySources,
    thisWeekOrganic,
    prevWeekOrganic,
    topDFPages,
    dailyTrend,
  ] = await Promise.all([
    // 1. Today — overall
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "newUsers" },
          { name: "totalUsers" },
        ],
      },
    }),
    // 2. Yesterday — overall
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: yesterday, endDate: yesterday }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "newUsers" },
        ],
      },
    }),
    // 3. This week — overall
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: sevenDaysAgo, endDate: today }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "newUsers" },
          { name: "totalUsers" },
        ],
      },
    }),
    // 4. Previous week — overall
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: fourteenDaysAgo, endDate: sevenDaysAgo }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "newUsers" },
        ],
      },
    }),
    // 5. Today — dye-free cluster only (total views)
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: dyeFreeFilter,
      },
    }),
    // 6. This week — dye-free cluster
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: sevenDaysAgo, endDate: today }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: dyeFreeFilter,
      },
    }),
    // 7. Previous week — dye-free cluster
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: fourteenDaysAgo, endDate: sevenDaysAgo }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: dyeFreeFilter,
      },
    }),
    // 8. Today — traffic sources
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 6,
      },
    }),
    // 9. This week — organic search sessions
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: sevenDaysAgo, endDate: today }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        dimensionFilter: {
          filter: {
            field_name: "sessionDefaultChannelGroup",
            string_filter: { match_type: "EXACT", value: "Organic Search" },
          },
        },
      },
    }),
    // 10. Previous week — organic search sessions
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: fourteenDaysAgo, endDate: sevenDaysAgo }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        dimensionFilter: {
          filter: {
            field_name: "sessionDefaultChannelGroup",
            string_filter: { match_type: "EXACT", value: "Organic Search" },
          },
        },
      },
    }),
    // 11. Top dye-free pages (7d)
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: sevenDaysAgo, endDate: today }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: dyeFreeFilter,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 5,
      },
    }),
    // 12. Daily sessions trend (last 7 days by date)
    client.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: sevenDaysAgo, endDate: today }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      },
    }),
  ]);

  // Parse helpers
  const val = (report, idx = 0) =>
    Number(report.data.rows?.[0]?.metricValues?.[idx]?.value || 0);
  const sumMetric = (report, idx = 0) =>
    (report.data.rows || []).reduce(
      (s, r) => s + Number(r.metricValues[idx]?.value || 0),
      0
    );

  // Today
  const tSessions = val(todayAll, 0);
  const tPVs = val(todayAll, 1);
  const tNewUsers = val(todayAll, 2);
  const tTotalUsers = val(todayAll, 3);

  // Yesterday
  const ySessions = val(yesterdayAll, 0);
  const yPVs = val(yesterdayAll, 1);
  const yNewUsers = val(yesterdayAll, 2);

  // This week
  const wSessions = val(thisWeekAll, 0);
  const wPVs = val(thisWeekAll, 1);
  const wNewUsers = val(thisWeekAll, 2);
  const wTotalUsers = val(thisWeekAll, 3);

  // Prev week
  const pwSessions = val(prevWeekAll, 0);
  const pwPVs = val(prevWeekAll, 1);
  const pwNewUsers = val(prevWeekAll, 2);

  // Dye-free cluster
  const dfToday = val(todayDyeFree, 0);
  const dfWeek = val(thisWeekDyeFree, 0);
  const dfPrevWeek = val(prevWeekDyeFree, 0);

  // Organic search
  const organicWeek = sumMetric(thisWeekOrganic, 0);
  const organicPrevWeek = sumMetric(prevWeekOrganic, 0);

  // Sources today
  const totalSrc = (todaySources.data.rows || []).reduce(
    (s, r) => s + Number(r.metricValues[0].value),
    0
  );
  const sources = (todaySources.data.rows || []).map((r) => ({
    ch: r.dimensionValues[0].value,
    n: Number(r.metricValues[0].value),
    pct: totalSrc
      ? Math.round((Number(r.metricValues[0].value) / totalSrc) * 100)
      : 0,
  }));

  // Top dye-free pages
  const topDF = (topDFPages.data.rows || []).map((r) => ({
    path: r.dimensionValues[0].value,
    views: Number(r.metricValues[0].value),
  }));

  // Daily trend sparkline (last 7 days)
  const dailySessions = (dailyTrend.data.rows || []).map((r) =>
    Number(r.metricValues[0].value)
  );

  // Derived KPIs
  const dfShareToday = tPVs > 0 ? Math.round((dfToday / tPVs) * 100) : 0;
  const dfShareWeek = wPVs > 0 ? Math.round((dfWeek / wPVs) * 100) : 0;
  const organicPctWeek =
    wSessions > 0 ? Math.round((organicWeek / wSessions) * 100) : 0;
  const newUserRate =
    wTotalUsers > 0 ? Math.round((wNewUsers / wTotalUsers) * 100) : 0;

  return {
    // Today vs yesterday
    tSessions,
    ySessions,
    tNewUsers,
    yNewUsers,
    tPVs,
    // Week vs prev week
    wSessions,
    pwSessions,
    wNewUsers,
    pwNewUsers,
    wPVs,
    pwPVs,
    // Dye-free cluster
    dfToday,
    dfWeek,
    dfPrevWeek,
    dfShareToday,
    dfShareWeek,
    topDF,
    // Organic search
    organicWeek,
    organicPrevWeek,
    organicPctWeek,
    // Sources
    sources,
    // Trend
    dailySessions,
    // Rates
    newUserRate,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// ─── Morning Strategy Scorecard ─────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════
async function sendMorningSummary() {
  log("📊 Building campaign scorecard...");

  const ga4 = await fetchTrafficKPIs().catch((e) => {
    log(`⚠️  GA4 error: ${e.message}`);
    return null;
  });

  // Reddit data
  let reddit = { total: 0, new24h: 0, hot: [] };
  try {
    const matchesPath = path.join(DATA_DIR, "reddit-matches.json");
    if (fs.existsSync(matchesPath)) {
      const matches = JSON.parse(fs.readFileSync(matchesPath, "utf8"));
      reddit.total = matches.length;
      const oneDayAgo = Date.now() / 1000 - 86400;
      reddit.new24h = matches.filter((m) => m.created_utc > oneDayAgo).length;
      reddit.hot = matches
        .filter((m) => m.created_utc > oneDayAgo && m.score >= 10)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }
  } catch {
    // ignore
  }

  // ── Build message ────────────────────────────────────────────────────
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  let msg = `📊 Campaign Scorecard — ${dateStr}\n`;

  if (!ga4) {
    msg += `\n[GA4 unavailable — check service account]\n`;
  } else {
    // ── VERDICT FIRST — the one line that matters ─────────────────────
    const weekUp =
      ga4.wSessions > ga4.pwSessions && ga4.pwSessions > 0;
    const organicUp =
      ga4.organicWeek > ga4.organicPrevWeek && ga4.organicPrevWeek > 0;
    const clusterUp =
      ga4.dfWeek > ga4.dfPrevWeek && ga4.dfPrevWeek > 0;
    const clusterPulling = ga4.dfShareWeek >= 10;

    const wins = [weekUp, organicUp, clusterUp].filter(Boolean).length;

    if (wins >= 3 || (wins >= 2 && clusterPulling)) {
      msg += `\n🟢 WORKING — traffic up, organic growing, content pulling weight\n`;
    } else if (wins >= 1) {
      msg += `\n🟡 BUILDING — ${weekUp ? "traffic trending up" : organicUp ? "organic growing" : "content getting views"}. Keep pushing.\n`;
    } else if (ga4.wSessions === 0 && ga4.pwSessions === 0) {
      msg += `\n⚪ NO DATA YET — too early to call. Check back in 48h.\n`;
    } else {
      msg += `\n🔴 NOT YET — content needs time to index. Give it 7 more days before pivoting.\n`;
    }

    // ── ORGANIC SEARCH — the #1 KPI for this SEO strategy ────────────
    msg += `\n🔍 ORGANIC SEARCH\n`;
    msg += `${ga4.organicWeek} sessions (7d) ${arrow(ga4.organicWeek, ga4.organicPrevWeek)} ${pctChange(ga4.organicWeek, ga4.organicPrevWeek)} vs prev wk\n`;
    msg += `Organic = ${ga4.organicPctWeek}% of total traffic\n`;

    // ── DYE-FREE CONTENT CLUSTER — is the campaign content getting found? ─
    msg += `\n🎯 DYE-FREE CONTENT\n`;
    msg += `Today: ${ga4.dfToday} views (${ga4.dfShareToday}% of traffic)\n`;
    msg += `7-day: ${ga4.dfWeek} views ${arrow(ga4.dfWeek, ga4.dfPrevWeek)} ${pctChange(ga4.dfWeek, ga4.dfPrevWeek)} vs prev wk\n`;
    msg += `Content = ${ga4.dfShareWeek}% of all pageviews\n`;

    // Top performing content pages
    if (ga4.topDF.length) {
      msg += `Winners:\n`;
      for (const p of ga4.topDF.slice(0, 3)) {
        const name = p.path
          .replace("/blog/", "")
          .replace("/dye-free-", "")
          .replace(/-/g, " ")
          .slice(0, 30);
        msg += `  ${name}: ${p.views}\n`;
      }
    }

    // ── TOTAL TRAFFIC — overall site health ──────────────────────────
    msg += `\n📈 SITE TRAFFIC\n`;
    msg += `Today: ${ga4.tSessions} sessions ${arrow(ga4.tSessions, ga4.ySessions)} (${pctChange(ga4.tSessions, ga4.ySessions)} vs yesterday)\n`;
    msg += `7-day: ${ga4.wSessions} sessions ${arrow(ga4.wSessions, ga4.pwSessions)} (${pctChange(ga4.wSessions, ga4.pwSessions)} vs prev wk)\n`;

    // ── NEW USERS — are we reaching new people? ─────────────────────
    msg += `\n👥 NEW USERS\n`;
    msg += `${ga4.wNewUsers} new users (7d) ${arrow(ga4.wNewUsers, ga4.pwNewUsers)} ${pctChange(ga4.wNewUsers, ga4.pwNewUsers)} vs prev wk\n`;
    msg += `${ga4.newUserRate}% of visitors are new\n`;

    // ── TRAFFIC SOURCES — where are they coming from? ───────────────
    if (ga4.sources.length) {
      msg += `\nSources: `;
      msg += ga4.sources.map((s) => `${s.ch} ${s.pct}%`).join(", ");
      msg += `\n`;
    }

    // ── 7-DAY SPARKLINE — visual daily trend ────────────────────────
    if (ga4.dailySessions.length >= 3) {
      const max = Math.max(...ga4.dailySessions, 1);
      const bars = ga4.dailySessions.map((v) => {
        const height = Math.round((v / max) * 4);
        return ["▁", "▂", "▃", "▅", "█"][height] || "▁";
      });
      msg += `\n7d trend: ${bars.join("")} (${ga4.dailySessions.join("→")})\n`;
    }
  }

  // ── REDDIT — community reach ──────────────────────────────────────
  msg += `\n📡 REDDIT\n`;
  msg += `${reddit.total} tracked · ${reddit.new24h} new (24h)\n`;
  if (reddit.hot.length) {
    for (const p of reddit.hot) {
      msg += `  🔥 r/${p.subreddit} ${p.score}pts: ${(p.title || "").slice(0, 35)}...\n`;
    }
  }

  // ── Send via iMessage ──────────────────────────────────────────────
  log(`📱 Sending scorecard to ${PHONE_NUMBERS.length} numbers...`);

  for (const phone of PHONE_NUMBERS) {
    try {
      const escaped = msg.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = iMessage
          set targetBuddy to participant "${phone}" of targetService
          send "${escaped}" to targetBuddy
        end tell
      `;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 15_000,
      });
      log(`✅ Sent to ${phone.slice(0, 3)}...${phone.slice(-4)}`);
    } catch (err) {
      log(`⚠️  Failed ${phone.slice(0, 3)}...${phone.slice(-4)}: ${err.message}`);
    }
  }

  return { success: true, message: msg };
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  const mode = parseArgs();
  log("═══════════════════════════════════════════════");
  log("🌙 USA Gummies Overnight Worker");
  log(
    `   Mode: ${mode.all ? "FULL RUN" : Object.keys(mode).filter((k) => mode[k]).join(", ")}`
  );
  log("═══════════════════════════════════════════════\n");

  if (mode.all || mode.reddit) {
    await runRedditMonitor();
    log("");
  }

  if (mode.all || mode.keywords) {
    await runKeywordTracker();
    log("");
  }

  if (mode.all || mode.calendar) {
    await runContentCalendar();
    log("");
  }

  if (mode.all || mode.summary) {
    await sendMorningSummary();
    log("");
  }

  log("═══════════════════════════════════════════════");
  log("✅ Done");
  log("═══════════════════════════════════════════════\n");
}

main().catch((err) => {
  log(`💥 Fatal error: ${err.message}`);
  process.exit(1);
});
