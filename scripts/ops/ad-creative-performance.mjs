#!/usr/bin/env node
// Ad-level creative performance ranking — pulls Meta Marketing API,
// scores every active ad on (CTR, CPC, hook rate, spend-to-conversion),
// outputs a kill list + scale list.
//
// Why: blanket campaign-level audits tell us we have 0 sales on $373 spend.
// Ad-level data tells us WHICH 5 of N creatives are dragging the average
// down vs which 1-2 are actually attempting to deliver.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(p) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv(resolve(homedir(), ".config/usa-gummies-mcp/.env-meta-tokens"));
loadEnv(resolve(__dirname, "..", "..", ".env.local"));

const TOKEN = (process.env.META_USER_ACCESS_TOKEN || "").trim();
let AD_ACCOUNT_ID = (process.env.META_AD_ACCOUNT_ID || "").trim();
if (!TOKEN || !AD_ACCOUNT_ID) {
  console.error("Missing META_USER_ACCESS_TOKEN or META_AD_ACCOUNT_ID env.");
  process.exit(1);
}
// Meta API requires `act_` prefix on the ad account ID
if (!AD_ACCOUNT_ID.startsWith("act_")) AD_ACCOUNT_ID = `act_${AD_ACCOUNT_ID}`;

async function gget(p) {
  const sep = p.includes("?") ? "&" : "?";
  const url = `https://graph.facebook.com/v21.0${p}${sep}access_token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Meta API ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

// Pause an ad via the Marketing API. Returns true on success.
async function pauseAd(adId, name) {
  const url = `https://graph.facebook.com/v21.0/${adId}`;
  const body = new URLSearchParams({ status: "PAUSED", access_token: TOKEN });
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) {
    const t = await res.text();
    console.error(`  ❌ Failed to pause ${name} (${adId}): ${t.slice(0, 200)}`);
    return false;
  }
  return true;
}

const EXECUTE = process.argv.includes("--execute");
const TOP_SPENDERS_TO_KEEP = 10;

async function pullAllPages(path) {
  const out = [];
  let next = `https://graph.facebook.com/v21.0${path}${path.includes("?") ? "&" : "?"}access_token=${TOKEN}`;
  while (next) {
    const r = await fetch(next);
    if (!r.ok) break;
    const j = await r.json();
    out.push(...(j.data || []));
    next = j.paging?.next || null;
  }
  return out;
}

console.log(`\n📊 USA Gummies — Ad Creative Performance Ranking`);
console.log(`   Account: ${AD_ACCOUNT_ID}\n`);

// 1. Pull all active ads + their creatives + insights (last 7 days)
const adFields = [
  "id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "adset_id",
  "creative{id,name,thumbnail_url,object_story_spec{video_data{title,message,call_to_action},link_data{name,message,call_to_action,description}}}",
  "insights.date_preset(last_7d){spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,unique_actions}",
].join(",");

const ads = await pullAllPages(`/${AD_ACCOUNT_ID}/ads?fields=${adFields}&limit=200`);
console.log(`Found ${ads.length} ads in account.\n`);

// 2. Score each ad
const scored = ads
  .filter((ad) => ad.effective_status === "ACTIVE" || ad.effective_status === "ADSET_PAUSED" || ad.effective_status === "CAMPAIGN_PAUSED" || ad.effective_status === "PAUSED")
  .map((ad) => {
    const insights = ad.insights?.data?.[0] || {};
    const spend = parseFloat(insights.spend || "0");
    const impressions = parseInt(insights.impressions || "0", 10);
    const clicks = parseInt(insights.clicks || "0", 10);
    const ctr = parseFloat(insights.ctr || "0"); // Already a percentage
    const cpc = parseFloat(insights.cpc || "0");
    const cpm = parseFloat(insights.cpm || "0");
    const reach = parseInt(insights.reach || "0", 10);
    const frequency = parseFloat(insights.frequency || "0");

    // Video hook rate (3s) = 25% video plays / impressions
    const v25 = parseInt(insights.video_p25_watched_actions?.[0]?.value || "0", 10);
    const hookRate = impressions > 0 ? (v25 / impressions) * 100 : null;

    // Conversion actions
    const actions = insights.actions || [];
    const purchases = parseInt(actions.find((a) => a.action_type === "purchase")?.value || "0", 10);
    const atcs = parseInt(actions.find((a) => a.action_type === "add_to_cart")?.value || "0", 10);
    const lpvs = parseInt(actions.find((a) => a.action_type === "landing_page_view")?.value || "0", 10);

    // Decide verdict
    let verdict = "—";
    let reason = "";
    if (spend < 5) {
      verdict = "TOO_NEW";
      reason = "needs more spend before judgment";
    } else if (impressions < 500) {
      verdict = "TOO_NEW";
      reason = "<500 impressions, not enough data";
    } else if (ctr < 0.7 && spend > 10) {
      verdict = "KILL";
      reason = `CTR ${ctr.toFixed(2)}% < 0.7% threshold`;
    } else if (cpc > 0.50 && spend > 15) {
      verdict = "KILL";
      reason = `CPC $${cpc.toFixed(2)} > $0.50 threshold`;
    } else if (spend > 25 && purchases === 0 && atcs < 2) {
      verdict = "KILL";
      reason = `$${spend.toFixed(2)} spent, 0 purchases, ${atcs} ATC`;
    } else if (hookRate !== null && hookRate < 20 && impressions > 1000) {
      verdict = "KILL";
      reason = `hook rate ${hookRate.toFixed(1)}% < 20% threshold`;
    } else if (purchases > 0 && (spend / purchases) < 30) {
      verdict = "SCALE";
      reason = `$${(spend / purchases).toFixed(2)} CAC — scale this`;
    } else if (ctr > 1.5 && cpc < 0.30) {
      verdict = "WATCH";
      reason = `solid CTR ${ctr.toFixed(2)}% / CPC $${cpc.toFixed(2)} — give it more time`;
    } else {
      verdict = "OK";
      reason = "marginal — keep watching";
    }

    return {
      id: ad.id,
      name: ad.name || "(unnamed)",
      campaignId: ad.campaign_id,
      adsetId: ad.adset_id,
      effective_status: ad.effective_status,
      spend,
      impressions,
      clicks,
      ctr,
      cpc,
      cpm,
      reach,
      frequency,
      hookRate,
      v25,
      lpvs,
      atcs,
      purchases,
      verdict,
      reason,
      creativeName: ad.creative?.name,
      thumbnail: ad.creative?.thumbnail_url,
    };
  });

// 3. Output by verdict
const byVerdict = (v) => scored.filter((a) => a.verdict === v).sort((a, b) => b.spend - a.spend);

console.log("═".repeat(70));
console.log("🔥 KILL LIST (delete these immediately)");
console.log("═".repeat(70));
const kills = byVerdict("KILL");
if (!kills.length) console.log("   (none yet — but watch the WATCH list)");
for (const a of kills) {
  console.log(`\n  ${a.name}`);
  console.log(`    spend $${a.spend.toFixed(2)} · imp ${a.impressions.toLocaleString()} · clicks ${a.clicks} · CTR ${a.ctr.toFixed(2)}% · CPC $${a.cpc.toFixed(2)}`);
  if (a.hookRate !== null) console.log(`    hook rate ${a.hookRate.toFixed(1)}% · LPV ${a.lpvs} · ATC ${a.atcs} · purchases ${a.purchases}`);
  console.log(`    🔥 ${a.reason}`);
  console.log(`    creative: ${a.creativeName || "—"}`);
}

console.log("\n" + "═".repeat(70));
console.log("👀 WATCH LIST (don't kill yet, give 24-48h more)");
console.log("═".repeat(70));
for (const a of byVerdict("WATCH")) {
  console.log(`\n  ${a.name}`);
  console.log(`    spend $${a.spend.toFixed(2)} · CTR ${a.ctr.toFixed(2)}% · CPC $${a.cpc.toFixed(2)} · ATC ${a.atcs}`);
  console.log(`    👀 ${a.reason}`);
}

console.log("\n" + "═".repeat(70));
console.log("📈 SCALE LIST (winners — give more budget)");
console.log("═".repeat(70));
const scales = byVerdict("SCALE");
if (!scales.length) console.log("   (none yet — no ad has produced a purchase)");
for (const a of scales) {
  console.log(`\n  ${a.name}`);
  console.log(`    spend $${a.spend.toFixed(2)} · purchases ${a.purchases} · CAC $${(a.spend / a.purchases).toFixed(2)}`);
  console.log(`    📈 ${a.reason}`);
}

console.log("\n" + "═".repeat(70));
console.log("⏳ TOO NEW (need more data)");
console.log("═".repeat(70));
const tooNew = byVerdict("TOO_NEW");
console.log(`   ${tooNew.length} ads in this bucket — total spend $${tooNew.reduce((s, a) => s + a.spend, 0).toFixed(2)}`);
if (tooNew.length <= 5) for (const a of tooNew) console.log(`     - ${a.name} (spend $${a.spend.toFixed(2)})`);

// 4. Summary
console.log("\n" + "═".repeat(70));
console.log("📊 SUMMARY");
console.log("═".repeat(70));
const counts = {
  KILL: kills.length,
  WATCH: byVerdict("WATCH").length,
  SCALE: scales.length,
  TOO_NEW: tooNew.length,
  OK: byVerdict("OK").length,
};
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(10)}: ${v}`);
}
console.log(`  TOTAL ACTIVE: ${scored.length}`);

// 5. Recommendation
const wastedSpend = kills.reduce((s, a) => s + a.spend, 0);
const totalSpend = scored.reduce((s, a) => s + a.spend, 0);
console.log(`\n  Wasted spend on kill-list (last 7d): $${wastedSpend.toFixed(2)} of $${totalSpend.toFixed(2)} total (${((wastedSpend / totalSpend) * 100).toFixed(0)}%)`);
console.log(`  Replace with: ${kills.length} new creative variants (1:1 swap)`);
console.log(`  Suggested batch: 3 anti-villain (No Red 40), 2 supply-chain (3 states), 2 UGC-style customer reactions`);
console.log("");

// 6. EXECUTE — pause kill list + concentrate budget on top spenders
//
// Logic:
//   - Pause every ad in KILL list (definitively bad)
//   - Keep top N spenders across all ACTIVE ads (Meta is already delivering them)
//   - Keep all WATCH list (CTR proves they're engaging)
//   - Pause everything else (the 100+ TOO_NEW long tail that's preventing
//     Meta from concentrating budget on its winners)
//
// Only runs when invoked with --execute flag.
if (!EXECUTE) {
  console.log("─".repeat(70));
  console.log("DRY RUN — pass --execute to actually pause ads. Showing plan only.");
  console.log("─".repeat(70));
}

// Identify ads to pause: KILL + (TOO_NEW + OK that are NOT in top 10 spenders)
const topSpenderIds = new Set(
  scored
    .filter((a) => a.effective_status === "ACTIVE")
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_SPENDERS_TO_KEEP)
    .map((a) => a.id),
);
const watchIds = new Set(byVerdict("WATCH").map((a) => a.id));
const killIds = new Set(kills.map((a) => a.id));

const toPause = scored.filter((a) => {
  if (a.effective_status !== "ACTIVE") return false; // already paused
  if (killIds.has(a.id)) return true; // kill always
  if (topSpenderIds.has(a.id)) return false; // keep top spenders
  if (watchIds.has(a.id)) return false; // keep watch list
  return true; // pause everything else
});

const toKeep = scored.filter(
  (a) => a.effective_status === "ACTIVE" && !toPause.some((p) => p.id === a.id),
);

console.log("\n" + "═".repeat(70));
console.log(`📋 PLAN: pause ${toPause.length} ads, keep ${toKeep.length} ads delivering`);
console.log("═".repeat(70));
console.log("\n  KEEPING (top spenders + WATCH list):");
for (const a of toKeep.sort((x, y) => y.spend - x.spend)) {
  const tag = killIds.has(a.id)
    ? "🔥KILL"
    : watchIds.has(a.id)
      ? "👀WATCH"
      : topSpenderIds.has(a.id)
        ? "💰TOP$"
        : "  ";
  console.log(`    ${tag.padEnd(8)} ${a.name.padEnd(50)} $${a.spend.toFixed(2).padStart(7)}  CTR ${a.ctr.toFixed(2)}%`);
}

if (EXECUTE) {
  console.log("\n" + "═".repeat(70));
  console.log(`🚀 EXECUTING: pausing ${toPause.length} ads...`);
  console.log("═".repeat(70));
  let paused = 0;
  let failed = 0;
  for (const a of toPause) {
    process.stdout.write(`  Pausing ${a.name.padEnd(60)}... `);
    const ok = await pauseAd(a.id, a.name);
    if (ok) {
      console.log("✅");
      paused++;
    } else {
      failed++;
    }
    // Tiny delay to avoid rate limit
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\n  Done: ${paused} paused, ${failed} failed.`);
  console.log(`  Account is now concentrated on ${toKeep.length} ads with ~$${toKeep.reduce((s, a) => s + a.spend, 0).toFixed(2)} of recent 7d spend.`);
} else {
  console.log("\n  Run with --execute to actually pause these ads.");
}
console.log("");
