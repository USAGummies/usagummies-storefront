#!/usr/bin/env node
/**
 * launch-review-ads.mjs
 *
 * Builds 3 review-as-ad variants on the proven pour_test photo, into the
 * winning ATC adset (USAG_Broad_US_18_65_v2_ATC_warmup, the same adset
 * where the only converting ad lives).
 *
 * Reuses the 3-step photo-post hack from add-round2-ads.mjs:
 *   1. POST /{page_id}/photos with public_url + caption + published=false
 *   2. POST /act_{account}/adcreatives with object_story_id + CTA override
 *   3. POST /act_{account}/ads with creative_id (PAUSED until Ben approves)
 *
 * After creation: generate previews via /{ad_id}/previews and write to
 * /tmp/review-ad-previews.html so Ben can see exactly how each will render.
 *
 * Run:
 *   node scripts/launch-review-ads.mjs
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
// Winning adset: USAG_Broad_US_18_65_v2_ATC_warmup (where pour_test_atc converted)
const ADSET_ID = "120245458396790294";
const STATUS = "PAUSED"; // Hold until Ben approves preview

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const SHOP_BASE = "https://usagummies.com/shop";
const IMAGE_URL = "https://www.usagummies.com/brand/ad-assets-round2/photo-pour-test.png";

function shopUrl(utmContent) {
  return `${SHOP_BASE}?utm_source=meta&utm_medium=cpc&utm_campaign=usag_review_voice&utm_content=${utmContent}&utm_term=coldsales`;
}

const CREATIVES = [
  {
    key: "review_niki_addicting",
    headline: "Addicting. Real Fruit. Made In America.",
    primaryText:
      `"The flavor and texture is next level and addicting." — Niki L., 5★ verified review.\n\n` +
      "Real-fruit gummy bears made in America. No artificial dyes. No high-fructose corn syrup.\n\n" +
      "5 classic flavors. 7.5oz bag. $5.99.",
  },
  {
    key: "review_michael_pride",
    headline: "Made In America. Tastes Like It.",
    primaryText:
      `"American pride in a bag." — Michael D., 5★ verified review.\n\n` +
      "Soft real-fruit gummy bears. Made in America by Americans. 5 classic flavors. No artificial junk.\n\n" +
      "7.5oz bag. $5.99.",
  },
  {
    key: "review_beau_soft_fresh",
    headline: "Soft. Fresh. Made Right Here.",
    primaryText:
      `"Great tasting, soft, and fresh gummy bears. I'll order again." — Beau M., 5★ verified review.\n\n` +
      "American-made. Real fruit. Zero artificial dyes. 5 classic flavors.\n\n" +
      "7.5oz bag. $5.99.",
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

async function getPreviews(adId, token) {
  // Pull both Instagram Reels and Feed previews — pour_test was IG conversion
  const formats = ["INSTAGRAM_STORY", "INSTAGRAM_STANDARD", "MOBILE_FEED_STANDARD"];
  const out = {};
  for (const fmt of formats) {
    try {
      const res = await fetch(`${GRAPH_BASE}/${adId}/previews?ad_format=${fmt}&access_token=${token}`);
      const json = await res.json();
      out[fmt] = json.data?.[0]?.body || null;
    } catch (e) {
      out[fmt] = null;
    }
  }
  return out;
}

async function main() {
  if (!TOKEN) { console.error("❌ Missing META_USER_ACCESS_TOKEN"); process.exit(1); }

  console.log(`USA Gummies — Review-as-Ad Launcher (3 variants, PAUSED for approval)`);
  console.log("─".repeat(72));
  console.log(`  Adset:  ${ADSET_ID} (USAG_Broad_US_18_65_v2_ATC_warmup)`);
  console.log(`  Image:  ${IMAGE_URL} (proven pour_test photo)`);
  console.log("");

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
    const link = shopUrl(c.key);
    const creative = await postFormData(`/act_${AD_ACCOUNT}/adcreatives`, {
      name: `USAG_review_${c.key}_creative`,
      object_story_id: postId,
      call_to_action: { type: "SHOP_NOW", value: { link } },
    }, TOKEN);
    console.log(` ✓ creative=${creative.id}`);

    process.stdout.write(`     ↳ Ad...`);
    const ad = await postFormData(`/act_${AD_ACCOUNT}/ads`, {
      name: `USAG_review_${c.key}`,
      adset_id: ADSET_ID,
      creative: { creative_id: creative.id },
      status: STATUS,
    }, TOKEN);
    console.log(` ✓ ad_id=${ad.id}`);

    results.push({ key: c.key, headline: c.headline, ad_id: ad.id, creative_id: creative.id });
  }

  console.log("");
  console.log("─".repeat(72));
  console.log(`✓  ${results.length} ads created (status=${STATUS})\n`);

  // Generate previews
  console.log("Generating previews...");
  const previewBlocks = [];
  for (const r of results) {
    const previews = await getPreviews(r.ad_id, TOKEN);
    previewBlocks.push({ ...r, previews });
    console.log(`  ${r.key}: ${Object.keys(previews).filter(k => previews[k]).length} formats`);
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>USA Gummies — Review Ads Preview</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #f5f1e8; margin: 0; padding: 24px; }
  h1 { color: #1a2540; }
  .ad { background: white; padding: 16px; margin-bottom: 24px; border: 2px solid #1a2540; box-shadow: 6px 6px 0 #c7362c; }
  .ad h2 { margin: 0 0 4px 0; color: #c7362c; font-size: 1.4rem; }
  .ad .meta { color: #666; font-size: 0.9rem; margin-bottom: 12px; }
  .formats { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .format { border: 1px solid #ddd; padding: 8px; }
  .format h3 { margin: 0 0 8px; font-size: 0.9rem; color: #666; text-transform: uppercase; }
  iframe { width: 100%; height: 720px; border: 0; }
</style></head><body>
<h1>USA Gummies — 3 Review-as-Ad Variants (PAUSED, awaiting approval)</h1>
<p>Same proven pour_test photo. Customer-voice copy from real verified-buyer 5★ reviews.</p>
${previewBlocks.map(b => `
<div class="ad">
  <h2>${b.headline}</h2>
  <div class="meta">${b.key} · ad_id ${b.ad_id} · creative ${b.creative_id}</div>
  <div class="formats">
    ${Object.entries(b.previews).filter(([_, v]) => v).map(([fmt, body]) => `
      <div class="format">
        <h3>${fmt}</h3>
        ${body}
      </div>
    `).join("")}
  </div>
</div>
`).join("")}
</body></html>`;

  const outPath = "/tmp/review-ad-previews.html";
  writeFileSync(outPath, html);
  console.log(`\n✓ Preview HTML written: ${outPath}\n`);

  console.log("Activate command (after Ben's approval):");
  for (const r of results) {
    console.log(`  curl -sX POST "https://graph.facebook.com/v21.0/${r.ad_id}?access_token=$META_USER_ACCESS_TOKEN" -d "status=ACTIVE"`);
  }
}

main().catch(err => { console.error("\n❌ Failed:", err.message); process.exit(1); });
