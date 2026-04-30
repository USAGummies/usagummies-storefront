#!/usr/bin/env node
/**
 * launch-buy4get1-abc-ads.mjs
 *
 * Builds 3 A/B/C ad copy variants on the proven pour_test photo, all selling
 * the entry-tier 5-Pack (Buy 4 Get 1 Free at $23.96 + FREE SHIPPING).
 *
 * Same proven photo (pour_test). Same /go destination. Same winning ATC adset.
 * Three different copy framings to find which converts best.
 *
 * Run:
 *   node scripts/launch-buy4get1-abc-ads.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const TOKEN_FILE = path.join(homedir(), ".config/usa-gummies-mcp/.env-meta-tokens");
if (existsSync(TOKEN_FILE)) {
  const text = readFileSync(TOKEN_FILE, "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)="(.+)"$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const TOKEN = (process.env.META_USER_ACCESS_TOKEN || "").trim();
const AD_ACCOUNT = (process.env.META_AD_ACCOUNT_ID || "780570388084650").trim();
const PAGE_ID = (process.env.META_PAGE_ID || "784331794768665").trim();
// Winning adset where pour_test_atc converted
const ADSET_ID = "120245458396790294";
const STATUS = "PAUSED"; // Hold for Ben's preview

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
// Send straight to the 5-Pack qty=5 cart so the BXGY discount auto-applies
const GO_BASE = "https://usagummies.com/go/checkout?qty=5";
const IMAGE_URL = "https://www.usagummies.com/brand/ad-assets-round2/photo-pour-test.png";

function landingUrl(content) {
  return `${GO_BASE}&utm_source=meta&utm_medium=cpc&utm_campaign=usag_b4g1f&utm_content=${content}`;
}

const CREATIVES = [
  {
    key: "abc_a_bogo_punch",
    headline: "Buy 4, Get 1 FREE",
    primaryText:
      "Buy 4 bags. Get 1 FREE. 🇺🇸\n\n" +
      "American-made gummy bears. No artificial dyes. No high-fructose corn syrup. Real fruit, 5 flavors.\n\n" +
      "5-Pack — $23.96. Free shipping on every order.",
  },
  {
    key: "abc_b_stack_freebies",
    headline: "1 Bag FREE + Free Shipping",
    primaryText:
      "1 Bag FREE. Free shipping. Free of artificial junk.\n\n" +
      "American-made dye-free gummy bears with every 4-pack. 5 fruit flavors. No Red 40, no Yellow 5, no Blue 1.\n\n" +
      "5-Pack — $23.96.",
  },
  {
    key: "abc_c_value_framed",
    headline: "5 Bags. $23.96. Free Ship.",
    primaryText:
      "5 Bags. $23.96. Free Shipping.\n\n" +
      "American-made dye-free gummy bears — that's 1 bag on us. ($4.79/bag.)\n\n" +
      "5 fruit flavors. Real fruit, no fake colors. Made in the USA.",
  },
];

async function getPageToken() {
  if (process.env.META_PAGE_ACCESS_TOKEN) return process.env.META_PAGE_ACCESS_TOKEN.trim();
  const res = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,access_token&access_token=${TOKEN}`);
  const json = await res.json();
  const page = (json.data || []).find(p => p.id === PAGE_ID);
  if (!page?.access_token) throw new Error("No page token");
  return page.access_token;
}

async function postFormData(p, body, token) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  params.append("access_token", token);
  const res = await fetch(`${GRAPH_BASE}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 300)}`); }
  if (!res.ok || json.error) throw new Error(`POST ${p}: ${json.error?.message || text.slice(0, 300)}`);
  return json;
}

async function main() {
  if (!TOKEN) { console.error("❌ Missing META_USER_ACCESS_TOKEN"); process.exit(1); }

  console.log("USA Gummies — A/B/C Ads (Buy 4 Get 1 Free) — PAUSED for approval");
  console.log("─".repeat(72));

  const pageToken = await getPageToken();
  console.log("✓ Got page access token\n");

  const results = [];
  for (let i = 0; i < CREATIVES.length; i++) {
    const c = CREATIVES[i];
    console.log(`${i + 1}/${CREATIVES.length}  ${c.key}`);

    process.stdout.write(`     ↳ Photo post...`);
    const photo = await postFormData(`/${PAGE_ID}/photos`, {
      url: IMAGE_URL,
      caption: c.primaryText,
      published: false,
    }, pageToken);
    const postId = `${PAGE_ID}_${photo.id}`;
    console.log(` ✓`);

    process.stdout.write(`     ↳ Ad creative...`);
    const link = landingUrl(c.key);
    const creative = await postFormData(`/act_${AD_ACCOUNT}/adcreatives`, {
      name: `USAG_${c.key}_creative`,
      object_story_id: postId,
      call_to_action: { type: "SHOP_NOW", value: { link } },
    }, TOKEN);
    console.log(` ✓ creative=${creative.id}`);

    process.stdout.write(`     ↳ Ad...`);
    const ad = await postFormData(`/act_${AD_ACCOUNT}/ads`, {
      name: `USAG_${c.key}`,
      adset_id: ADSET_ID,
      creative: { creative_id: creative.id },
      status: STATUS,
    }, TOKEN);
    console.log(` ✓ ad_id=${ad.id}`);

    results.push({ key: c.key, headline: c.headline, ad_id: ad.id, link });
  }

  console.log("\n" + "─".repeat(72));
  console.log(`✓  ${results.length} ads created (status=${STATUS})\n`);
  console.log("Activate after approval:");
  for (const r of results) {
    console.log(`  curl -sX POST "https://graph.facebook.com/v21.0/${r.ad_id}?access_token=$META_USER_ACCESS_TOKEN" -d "status=ACTIVE"`);
  }
  console.log("\nLanding (after BXGY auto-applies):");
  for (const r of results) console.log(`  ${r.key}: ${r.link}`);
}

main().catch(err => { console.error("\n❌ Failed:", err.message); process.exit(1); });
