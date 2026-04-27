#!/usr/bin/env node
/**
 * USA Gummies Content Factory — Generator CLI
 *
 * Generates a brand-coherent ad creative using OpenAI gpt-image-1 + a locked
 * style profile, saves it to the repo, and posts it to Slack #ops-approvals
 * for Ben's approval. Approved images are recorded in Vercel KV and become
 * available for any future ad campaign.
 *
 * Usage:
 *   node scripts/content-factory/generate.mjs <profile> "<concept>" [N]
 *
 * Examples:
 *   node scripts/content-factory/generate.mjs comic-americana \
 *     "A vintage red truck pulling a USA Gummies trailer through Western plains"
 *
 *   node scripts/content-factory/generate.mjs photo-editorial \
 *     "Open bag of gummies tipped over, bears spilled across worn maple cutting board, single window light"
 *
 *   node scripts/content-factory/generate.mjs comic-working-class \
 *     "Construction site at dawn, half-built timber-frame house, vintage red pickup with USA Gummies crates" 2
 *
 * The third argument N (default 1) generates N variants.
 *
 * Required env vars:
 *   OPENAI_API_KEY                  — OpenAI API key
 *   SLACK_BOT_TOKEN                 — Slack bot token (xoxb-*)
 *   CONTENT_FACTORY_APPROVAL_SECRET — optional, secures the approval URLs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateImage, composePrompt } from "./lib/openai-image.mjs";
import { postForApproval } from "./lib/slack-approval.mjs";

// ---------------------------------------------------------------------------
// Load env from .env.local (or .env.local.bak fallback)
// ---------------------------------------------------------------------------

function loadEnvFile(p) {
  if (!existsSync(p)) return false;
  const text = readFileSync(p, "utf-8");
  for (const line of text.split("\n")) {
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

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
loadEnvFile(path.join(REPO_ROOT, ".env.local")) || loadEnvFile(path.join(REPO_ROOT, ".env.local.bak"));

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const [, , profileKey, conceptText, nArg] = process.argv;
if (!profileKey || !conceptText) {
  console.error("Usage: node scripts/content-factory/generate.mjs <profile> \"<concept>\" [N]");
  console.error("");
  console.error("Available profiles (from data/content-factory/style-profiles.json):");
  const profiles = JSON.parse(readFileSync(path.join(REPO_ROOT, "data/content-factory/style-profiles.json"), "utf-8"));
  for (const [key, prof] of Object.entries(profiles)) {
    if (key.startsWith("_")) continue;
    console.error(`  - ${key.padEnd(24)} ${prof.description?.slice(0, 80) || ""}`);
  }
  process.exit(1);
}
const N = Math.max(1, Math.min(10, parseInt(nArg || "1", 10) || 1));

// ---------------------------------------------------------------------------
// Load style profile
// ---------------------------------------------------------------------------

const profilesData = JSON.parse(readFileSync(path.join(REPO_ROOT, "data/content-factory/style-profiles.json"), "utf-8"));
const styleProfile = profilesData[profileKey];
if (!styleProfile) {
  console.error(`Unknown profile: ${profileKey}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Required secrets
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const SLACK_BOT_TOKEN = (process.env.SLACK_BOT_TOKEN || "").trim();
if (!OPENAI_API_KEY) { console.error("❌ OPENAI_API_KEY missing"); process.exit(1); }
if (!SLACK_BOT_TOKEN) { console.error("❌ SLACK_BOT_TOKEN missing"); process.exit(1); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const batchId = `${profileKey}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6)}`;
  const fullPrompt = composePrompt({ styleProfile, conceptText });
  const referenceImagePath = styleProfile.reference_image
    ? path.join(REPO_ROOT, styleProfile.reference_image)
    : null;

  console.log(`🎨 USA Gummies Content Factory`);
  console.log("─".repeat(60));
  console.log(`  Profile:   ${styleProfile.name} (${profileKey})`);
  console.log(`  Concept:   ${conceptText.slice(0, 80)}${conceptText.length > 80 ? "..." : ""}`);
  console.log(`  N images:  ${N}`);
  console.log(`  Batch ID:  ${batchId}`);
  console.log(`  Reference: ${referenceImagePath ? "✓ " + path.relative(REPO_ROOT, referenceImagePath) : "(none)"}`);
  console.log("");

  const results = [];
  for (let i = 1; i <= N; i++) {
    const imageId = `${batchId}-${i}`;
    const outputRel = `public/brand/factory/${batchId}/${i}.png`;
    const outputPath = path.join(REPO_ROOT, outputRel);

    console.log(`[${i}/${N}] Generating ${imageId}...`);
    process.stdout.write("       ↳ OpenAI gpt-image-1...");
    let result;
    try {
      result = await generateImage({
        prompt: fullPrompt,
        referenceImagePath,
        outputPath,
        dimensions: styleProfile.dimensions || "1024x1024",
        quality: styleProfile.quality || "high",
        apiKey: OPENAI_API_KEY,
      });
    } catch (e) {
      console.log(" ✗");
      console.error(`       ${e.message}`);
      continue;
    }
    console.log(` ✓ saved`);

    // Image is on disk but Vercel won't serve it until pushed.
    // For the Slack preview, we need a URL Slack can fetch.
    // Two options:
    //   (a) Commit + push, wait for Vercel deploy (slow but archival)
    //   (b) Upload to Slack as file (faster but image lives only in Slack)
    // We use (a) for permanence — also makes the image immediately reusable
    // from the public URL.
    const imageUrl = `https://www.usagummies.com/brand/factory/${batchId}/${i}.png`;

    results.push({
      imageId,
      outputPath,
      outputRel,
      imageUrl,
      revisedPrompt: result.revisedPrompt,
    });
  }

  if (results.length === 0) {
    console.error("\n❌ No images generated successfully.");
    process.exit(1);
  }

  // Commit + push to Vercel
  console.log("");
  console.log("📦 Committing + pushing to Vercel...");
  const { execSync } = await import("node:child_process");
  try {
    execSync(`cd ${REPO_ROOT} && git add ${results.map(r => r.outputRel).join(" ")}`, { stdio: "inherit" });
    const commitMsg = `feat(content-factory): generate ${results.length} ${profileKey} variant(s)\n\nConcept: ${conceptText.slice(0, 200)}${conceptText.length > 200 ? "..." : ""}\nBatch: ${batchId}\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
    execSync(`cd ${REPO_ROOT} && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: "inherit" });
    execSync(`cd ${REPO_ROOT} && git push origin main`, { stdio: "inherit" });
    console.log("✓ pushed to main");
  } catch (e) {
    console.error("⚠ git push failed:", e.message);
    console.error("Continuing — Slack preview will fail until images are deployed.");
  }

  // Wait briefly for Vercel deploy + verify URL is reachable
  console.log("");
  console.log("🔄 Waiting for Vercel deploy...");
  for (let attempt = 0; attempt < 12; attempt++) {
    const probe = await fetch(`${results[0].imageUrl}?cb=${Date.now()}`, { method: "HEAD" }).catch(() => null);
    if (probe?.ok) {
      console.log(`✓ images live (${attempt + 1}×15s)`);
      break;
    }
    if (attempt === 11) console.log("⚠ images still not served — Slack preview may show broken link, but you can refresh later.");
    await new Promise((r) => setTimeout(r, 15000));
  }

  // Post each to Slack with approval buttons + register in KV
  console.log("");
  console.log("📨 Posting to Slack #ops-approvals...");
  const KV_REST_API_URL = process.env.KV_REST_API_URL?.trim();
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN?.trim();
  for (const r of results) {
    // Register in KV as "pending" so the approval webhook can find it
    if (KV_REST_API_URL && KV_REST_API_TOKEN) {
      const kvKey = `content-factory:pending:${r.imageId}`;
      const kvVal = {
        id: r.imageId,
        profile: profileKey,
        concept: conceptText,
        prompt_excerpt: fullPrompt.slice(0, 1000),
        revised_prompt: r.revisedPrompt,
        image_path: r.outputRel,
        image_url: r.imageUrl,
        generated_at: new Date().toISOString(),
        cost_estimate_usd: 0.04,
      };
      try {
        await fetch(`${KV_REST_API_URL}/set/${kvKey}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(kvVal),
        });
      } catch (e) {
        console.error(`     ⚠ KV register failed for ${r.imageId}: ${e.message}`);
      }
    }

    try {
      const slackResult = await postForApproval({
        slackBotToken: SLACK_BOT_TOKEN,
        imageUrl: r.imageUrl,
        imageId: r.imageId,
        styleProfile: { ...styleProfile, name: styleProfile.name },
        conceptText,
        prompt: fullPrompt,
        metadata: { imagePath: r.outputRel },
      });
      console.log(`  ✓ ${r.imageId} → ${slackResult.message_link}`);
    } catch (e) {
      console.error(`  ✗ ${r.imageId} → ${e.message}`);
    }
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(`✓  ${results.length} image(s) generated & posted for approval`);
  console.log(`   Cost: ~$${(results.length * 0.04).toFixed(2)}`);
  console.log(`   Approve in Slack → image enters registry → reusable for future campaigns`);
}

main().catch((e) => {
  console.error("\n❌ FATAL:", e.message);
  process.exit(1);
});
