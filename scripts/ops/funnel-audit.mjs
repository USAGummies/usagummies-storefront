#!/usr/bin/env node
/**
 * USA Gummies Funnel Audit — runs every 6 hours.
 *
 * Pulls a full snapshot of:
 *   1. Meta delivery state (spend, impressions, clicks, reach)
 *   2. Per-ad-set & per-campaign breakdown
 *   3. Pixel events (PageView, ATC, IC, Purchase)
 *   4. Account health (balance, DSL, account_status)
 *   5. Shopify orders & checkouts (last 6h + today)
 *   6. Compares to last-run snapshot for trend
 *   7. Surfaces anomalies (delivery drops, error rates, etc.)
 *
 * Posts to Slack #marketing.
 *
 * State persists in ~/.config/usa-gummies-mcp/funnel-audit-state.json
 * so each run can compare to the previous run.
 *
 * Usage:
 *   node scripts/ops/funnel-audit.mjs                # normal run
 *   node scripts/ops/funnel-audit.mjs --no-slack     # don't post to Slack
 *   node scripts/ops/funnel-audit.mjs --silent       # only post on anomaly
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Env loader — supports .env.local in the repo + standalone tokens
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TOKEN_FILE = path.join(homedir(), ".config/usa-gummies-mcp/.env-meta-tokens");
const SHOP_TOKEN_FILE = path.join(homedir(), ".config/usa-gummies-mcp/.env-daily-report");
const STATE_FILE = path.join(homedir(), ".config/usa-gummies-mcp/funnel-audit-state.json");

function loadEnvFile(p) {
  if (!existsSync(p)) return false;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) {
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
  return true;
}

loadEnvFile(TOKEN_FILE);
loadEnvFile(SHOP_TOKEN_FILE);
loadEnvFile(path.join(REPO_ROOT, ".env.local"));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const META_TOKEN = (process.env.META_USER_ACCESS_TOKEN || "").trim();
const META_ACCOUNT = "780570388084650";
const META_PIXEL = "664545086717590";
const META_CAMPAIGNS = [
  { id: "120245331362440294", name: "Sales (Cold)" },
  { id: "120245458536010294", name: "Traffic (Warmup)" },
  { id: "120245502590140294", name: "Awareness (Reach)" },
  { id: "120245502590290294", name: "Traffic (Link Clicks)" },
];
const SHOPIFY_TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "").trim();
const SHOPIFY_DOMAIN = "usa-gummies.myshopify.com";
const META_DEVELOPER_APP_ID = "1562149058210193"; // app needs to stay Published
const SLACK_WEBHOOK = (process.env.SLACK_SUPPORT_WEBHOOK_URL || "").trim();
const SLACK_MARKETING_CHANNEL = "C08J9EER9L5"; // #marketing
const SLACK_BOT_TOKEN = (process.env.SLACK_BOT_TOKEN || "").trim();

const args = process.argv.slice(2);
const NO_SLACK = args.includes("--no-slack");
const SILENT = args.includes("--silent"); // only post on anomaly

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gget(p) {
  const sep = p.includes("?") ? "&" : "?";
  const res = await fetch(`https://graph.facebook.com/v21.0${p}${sep}access_token=${META_TOKEN}`);
  const j = await res.json();
  if (j.error) throw new Error(`Meta GET ${p}: ${j.error.message}`);
  return j;
}

async function shopifyGet(p) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-10${p}`, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN },
  });
  const j = await res.json();
  if (j.errors) throw new Error(`Shopify ${p}: ${JSON.stringify(j.errors)}`);
  return j;
}

function fmt$(cents) {
  if (cents == null) return "?";
  return `$${(parseInt(cents) / 100).toFixed(2)}`;
}

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return null;
}

function saveState(state) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Audit pulls
// ---------------------------------------------------------------------------

async function pullMetaDelivery() {
  // Account-wide today
  const today = await gget(`/act_${META_ACCOUNT}/insights?fields=spend,impressions,clicks,reach,actions&date_preset=today`);
  const todayRow = (today.data || [])[0] || {};

  // Per campaign
  const perCampaign = [];
  for (const c of META_CAMPAIGNS) {
    try {
      const ins = await gget(`/${c.id}/insights?fields=spend,impressions,clicks&date_preset=today`);
      const cs = await gget(`/${c.id}?fields=name,effective_status,configured_status,daily_budget`);
      perCampaign.push({
        ...c,
        status: cs.effective_status,
        daily: parseInt(cs.daily_budget || 0) / 100,
        spend: parseFloat(ins.data?.[0]?.spend || 0),
        impressions: parseInt(ins.data?.[0]?.impressions || 0),
        clicks: parseInt(ins.data?.[0]?.clicks || 0),
      });
    } catch (e) {
      perCampaign.push({ ...c, error: e.message });
    }
  }

  return {
    spend: parseFloat(todayRow.spend || 0),
    impressions: parseInt(todayRow.impressions || 0),
    clicks: parseInt(todayRow.clicks || 0),
    reach: parseInt(todayRow.reach || 0),
    actions: todayRow.actions || [],
    perCampaign,
  };
}

async function pullPixelEvents() {
  // Last 6h of pixel events
  const sixH = Math.floor(Date.now() / 1000) - 6 * 3600;
  try {
    const stats = await gget(`/${META_PIXEL}/stats?aggregation=event&start_time=${sixH}`);
    const totals = {};
    for (const window of stats.data || []) {
      for (const ev of window.data || []) {
        totals[ev.value] = (totals[ev.value] || 0) + ev.count;
      }
    }
    const meta = await gget(`/${META_PIXEL}?fields=name,last_fired_time,is_unavailable,enable_automatic_matching`);
    return {
      last_fired_time: meta.last_fired_time,
      is_unavailable: meta.is_unavailable,
      automatic_matching: meta.enable_automatic_matching,
      events_last_6h: totals,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function pullAccountHealth() {
  try {
    const acct = await gget(`/act_${META_ACCOUNT}?fields=balance,amount_spent,spend_cap,account_status,disable_reason,name`);
    return {
      name: acct.name,
      status: acct.account_status,
      disable_reason: acct.disable_reason,
      balance: fmt$(acct.balance),
      lifetime_spent: fmt$(acct.amount_spent),
      account_cap: fmt$(acct.spend_cap),
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function pullShopify() {
  if (!SHOPIFY_TOKEN) return { error: "no SHOPIFY_TOKEN" };
  try {
    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
    const sixH = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

    const [todayCount, sixHOrders, sixHCheckouts] = await Promise.all([
      shopifyGet(`/orders/count.json?status=any&created_at_min=${todayStart}`),
      shopifyGet(`/orders.json?status=any&created_at_min=${sixH}&fields=id,created_at,total_price,financial_status&limit=20`),
      shopifyGet(`/checkouts.json?created_at_min=${sixH}&limit=20&fields=id,created_at,total_price,email`),
    ]);

    const orders6h = (sixHOrders.orders || []);
    return {
      orders_today: todayCount.count,
      orders_6h: orders6h.length,
      revenue_6h: orders6h.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0).toFixed(2),
      checkouts_started_6h: (sixHCheckouts.checkouts || []).length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function pullDevAppStatus() {
  // Verify the developer app is still Published. Critical because if it
  // gets reverted to Sandbox, all delivery silently dies.
  try {
    const app = await gget(`/${META_DEVELOPER_APP_ID}?fields=name,namespace,company`);
    return {
      app_id: META_DEVELOPER_APP_ID,
      app_name: app.name,
      // The actual is_in_dev_mode field isn't exposed via API, so we
      // surface metadata that suggests live state. Manual check in UI
      // remains the source of truth.
      check_url: `https://developers.facebook.com/apps/${META_DEVELOPER_APP_ID}/dashboard/`,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function detectAnomalies(current, previous) {
  const flags = [];

  // Delivery dropped to zero
  if (previous?.delivery?.spend > 0 && current.delivery.spend === 0 && current.delivery.impressions === 0) {
    flags.push({ severity: "high", text: `Delivery dropped to $0/0 imp (was $${previous.delivery.spend.toFixed(2)})` });
  }

  // Daily spend not progressing as expected (>4h since first impression with no further movement)
  const sinceLastFired = current.pixel.last_fired_time
    ? (Date.now() - new Date(current.pixel.last_fired_time).getTime()) / 3600000
    : 999;
  if (sinceLastFired > 12) {
    flags.push({ severity: "medium", text: `Pixel last_fired ${sinceLastFired.toFixed(1)}h ago — pixel may be silent` });
  }

  // Account-level concerns
  if (current.account.disable_reason && current.account.disable_reason !== 0) {
    flags.push({ severity: "critical", text: `Account disable_reason: ${current.account.disable_reason}` });
  }

  // Conversion check — if impressions are growing but no purchases for 24h+
  if (current.delivery.impressions > 1000 && current.shopify.orders_today === 0 && current.delivery.clicks > 20) {
    flags.push({ severity: "low", text: `${current.delivery.impressions} imp, ${current.delivery.clicks} clicks, 0 orders — funnel leak` });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const start = Date.now();
  if (!META_TOKEN) {
    console.error("❌ META_USER_ACCESS_TOKEN missing");
    process.exit(1);
  }

  console.log("🔍 USA Gummies Funnel Audit");
  console.log(`   ${new Date().toISOString()}`);

  const [delivery, pixel, account, shopify, devApp] = await Promise.all([
    pullMetaDelivery(),
    pullPixelEvents(),
    pullAccountHealth(),
    pullShopify(),
    pullDevAppStatus(),
  ]);

  const previous = loadState();
  const current = { delivery, pixel, account, shopify, devApp, ts: new Date().toISOString() };
  const anomalies = detectAnomalies(current, previous);

  saveState(current);

  // ---------- Build summary ----------
  const lines = [];
  lines.push(`📊 *Funnel Audit — ${new Date().toLocaleString("en-US", { timeZone: "America/Boise", hour12: false })} MT*`);
  lines.push("");
  lines.push(`*Meta Delivery (today, account-wide):*`);
  lines.push(`  spend=$${delivery.spend.toFixed(2)} | imp=${delivery.impressions.toLocaleString()} | clicks=${delivery.clicks} | reach=${delivery.reach.toLocaleString()}`);
  lines.push("");
  lines.push(`*Per Campaign:*`);
  for (const c of delivery.perCampaign) {
    lines.push(`  ${c.name}: ${c.status} | $${c.spend.toFixed(2)} / ${c.impressions} imp / ${c.clicks} clicks`);
  }
  lines.push("");
  lines.push(`*Pixel Events (last 6h):*`);
  if (pixel.events_last_6h && Object.keys(pixel.events_last_6h).length > 0) {
    for (const [k, v] of Object.entries(pixel.events_last_6h)) {
      lines.push(`  ${k}: ${v}`);
    }
  } else {
    lines.push(`  (no events recorded)`);
  }
  lines.push(`  last_fired: ${pixel.last_fired_time || "?"}`);
  lines.push("");
  lines.push(`*Shopify (last 6h):*`);
  if (shopify.error) {
    lines.push(`  ERROR: ${shopify.error}`);
  } else {
    lines.push(`  orders today: ${shopify.orders_today} | orders last 6h: ${shopify.orders_6h} | revenue: $${shopify.revenue_6h} | checkouts started: ${shopify.checkouts_started_6h}`);
  }
  lines.push("");
  lines.push(`*Account:* status=${account.status} | balance=${account.balance} | lifetime=${account.lifetime_spent}`);
  lines.push(`*Dev App:* ${devApp.app_name || "?"} (verify Published: ${devApp.check_url || "n/a"})`);
  lines.push("");

  if (previous) {
    const dSpend = (delivery.spend - (previous.delivery.spend || 0)).toFixed(2);
    const dImp = delivery.impressions - (previous.delivery.impressions || 0);
    const dOrders = (shopify.orders_today || 0) - (previous.shopify?.orders_today || 0);
    lines.push(`*vs last audit:* +$${dSpend} spend | +${dImp} imp | +${dOrders} orders`);
  }
  lines.push("");
  if (anomalies.length > 0) {
    lines.push(`🚨 *Anomalies:*`);
    for (const a of anomalies) {
      const icon = a.severity === "critical" ? "🔴" : a.severity === "high" ? "🟠" : a.severity === "medium" ? "🟡" : "🔵";
      lines.push(`  ${icon} [${a.severity.toUpperCase()}] ${a.text}`);
    }
  } else {
    lines.push(`✅ No anomalies detected.`);
  }
  lines.push("");
  lines.push(`_run took ${Math.round((Date.now() - start) / 100) / 10}s_`);

  const message = lines.join("\n");
  console.log("\n" + message);

  // ---------- Post to Slack ----------
  if (!NO_SLACK && (anomalies.length > 0 || !SILENT)) {
    if (SLACK_BOT_TOKEN && SLACK_MARKETING_CHANNEL) {
      try {
        const r = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: SLACK_MARKETING_CHANNEL, text: message, mrkdwn: true }),
        });
        const j = await r.json();
        if (j.ok) console.log("✓ Posted to #marketing");
        else console.log(`⚠ Slack post failed: ${j.error}`);
      } catch (e) {
        console.log(`⚠ Slack post failed: ${e.message}`);
      }
    } else if (SLACK_WEBHOOK) {
      try {
        await fetch(SLACK_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ text: message, mrkdwn: true }),
        });
        console.log("✓ Posted via webhook");
      } catch (e) {
        console.log(`⚠ Webhook post failed: ${e.message}`);
      }
    } else {
      console.log("(no SLACK_BOT_TOKEN or SLACK_SUPPORT_WEBHOOK_URL — skipping Slack)");
    }
  }
}

main().catch((e) => {
  console.error("\n❌ Audit failed:", e.message);
  process.exit(1);
});
