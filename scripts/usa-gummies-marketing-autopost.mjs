#!/usr/bin/env node
/**
 * USA Gummies — Marketing Auto-Post Engine
 *
 * Autonomous marketing agent that generates social content + images
 * and posts to X and Truth Social.
 *
 * Agents:
 *   MKT1 — Daily Social Post Generator      Daily 10:00 AM ET
 *   MKT2 — Content Recycler                 Daily 2:00 PM ET
 *   MKT3 — Auto-Post History Reporter        Daily 8:00 PM ET
 *
 * Usage:
 *   node scripts/usa-gummies-marketing-autopost.mjs run MKT1
 *   node scripts/usa-gummies-marketing-autopost.mjs run all
 *   node scripts/usa-gummies-marketing-autopost.mjs status
 *   node scripts/usa-gummies-marketing-autopost.mjs help
 */

import fs from "node:fs";
import path from "node:path";
import {
  createEngine,
  todayET,
  nowETTimestamp,
  safeJsonRead,
  safeJsonWrite,
  fetchWithTimeout,
  textBen,
} from "./lib/usa-gummies-shared.mjs";

const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const STATE_FILE = path.join(CONFIG_DIR, "marketing-autopost-state.json");

// ── Agent Registry ──────────────────────────────────────────────────────────

const IDS = {};

const SCHEDULE_PLAN = {
  MKT1: { label: "Daily Social Post Generator", cron: "0 10 * * *", description: "Generates + posts social content daily" },
  MKT2: { label: "Content Recycler", cron: "0 14 * * *", description: "Re-promotes top blog posts" },
  MKT3: { label: "Auto-Post History Reporter", cron: "0 20 * * *", description: "Reports posting performance" },
};

// ── Engine Bootstrap ────────────────────────────────────────────────────────

const engine = createEngine({
  name: "marketing-autopost",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

const log = (msg) => engine.log(msg);

// ── State ───────────────────────────────────────────────────────────────────

function loadState() {
  return safeJsonRead(STATE_FILE, {
    postsToday: [],
    lastTopics: [],
    lastRun: {},
    totalPosts: 0,
  });
}

function saveState(state) {
  safeJsonWrite(STATE_FILE, state);
}

// ── Credential helpers ──────────────────────────────────────────────────────

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

function openaiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function twitterToken() {
  return process.env.TWITTER_ACCESS_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
}

function truthToken() {
  return process.env.TRUTHSOCIAL_ACCESS_TOKEN || "";
}

// ── Topic Generator ─────────────────────────────────────────────────────────

const TOPIC_POOL = [
  "Why American-made gummy vitamins are the healthier choice",
  "Our gummies are packed with real fruit flavors — no artificial colors",
  "Boost your daily wellness routine with USA Gummies",
  "Made in the USA with premium ingredients you can trust",
  "The difference between cheap gummies and quality gummy vitamins",
  "Start your morning right with our vitamin gummies",
  "Supporting American jobs — every bottle is made domestically",
  "Kids love our gummies, parents love the nutrition",
  "Why more families are switching to USA Gummies",
  "Natural ingredients, great taste, made in America",
  "Your daily dose of vitamins just got a lot more delicious",
  "Premium gummy vitamins at a fair price — direct from the manufacturer",
  "What makes our gummies different from the competition",
  "Clean label, transparent ingredients, American quality",
  "Health-conscious Americans choose USA Gummies",
  "Our customers' favorite flavors and why they keep coming back",
  "From our kitchen to yours — the USA Gummies promise",
  "Why vitamin gummies are the fastest-growing supplement category",
  "Quality you can taste, values you can trust",
  "Join thousands of happy customers choosing USA Gummies",
];

function pickTopic(recentTopics) {
  const recent = new Set(recentTopics || []);
  const available = TOPIC_POOL.filter((t) => !recent.has(t));
  const pool = available.length > 0 ? available : TOPIC_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Generate social copy via OpenAI ─────────────────────────────────────────

async function generateCopy(topic) {
  const key = openaiKey();
  if (!key) {
    // Fallback to simple template
    return {
      xPost: `${topic} 🇺🇸 #USAGummies #MadeInAmerica #VitaminGummies`,
      truthPost: `${topic} 🇺🇸 Made in America, trusted by families nationwide. #USAGummies`,
    };
  }

  const system =
    "You write on-brand social copy for USA Gummies, an American-made gummy vitamin brand. " +
    "Keep claims factual. No political statements. Be patriotic but professional. " +
    "Tone: friendly, health-conscious, proud.";

  async function chat(userMsg) {
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.8,
          max_tokens: 200,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        }),
      },
      25000,
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() || null;
  }

  const [xPost, truthPost] = await Promise.all([
    chat(`Write one X/Twitter post (max 270 chars) about: ${topic}. Include 2-3 hashtags. Include a call to action.`),
    chat(`Write one Truth Social post (max 480 chars) about: ${topic}. Patriotic but factual tone. Include 2-3 hashtags.`),
  ]);

  return {
    xPost: xPost || `${topic} 🇺🇸 #USAGummies #MadeInAmerica`,
    truthPost: truthPost || `${topic} 🇺🇸 Made in America. #USAGummies`,
  };
}

// ── Generate image via Gemini ───────────────────────────────────────────────

async function generateImage(topic) {
  const key = geminiKey();
  if (!key) {
    log("MKT1 image generation skipped: no Gemini API key");
    return null;
  }

  const prompt =
    `Create a high-quality marketing image for USA Gummies, an American-made gummy vitamin brand. ` +
    `Topic: ${topic}. ` +
    `Style: Eye-catching social media graphic. Bold colors, modern design. ` +
    `Vibrant, professional, and suitable for social media posting. ` +
    `Do NOT include any text or words in the image itself.`;

  const model = "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    },
    60000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log(`MKT1 Gemini failed (${res.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }

  log("MKT1 Gemini returned no image data");
  return null;
}

// ── Post to social platforms ────────────────────────────────────────────────

async function postToX(text) {
  const token = twitterToken();
  if (!token) return { ok: false, error: "No Twitter token" };

  const res = await fetchWithTimeout(
    "https://api.twitter.com/2/tweets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
    20000,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `X API ${res.status}: ${errText.slice(0, 200)}` };
  }

  const json = await res.json();
  return { ok: true, id: json?.data?.id };
}

async function postToTruth(text) {
  const token = truthToken();
  if (!token) return { ok: false, error: "No Truth Social token" };

  const res = await fetchWithTimeout(
    "https://truthsocial.com/api/v1/statuses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: text }),
    },
    20000,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `Truth API ${res.status}: ${errText.slice(0, 200)}` };
  }

  const json = await res.json();
  return { ok: true, id: json?.id };
}

// ── MKT1: Daily Social Post Generator ───────────────────────────────────────

async function dailyPost() {
  const state = loadState();
  const today = todayET();

  // Limit to 3 auto-posts per day
  const todayPosts = (state.postsToday || []).filter((p) => p.date === today);
  if (todayPosts.length >= 3) {
    log("MKT1 skipped: already posted 3 times today");
    return { processed: 0, notes: "daily limit reached" };
  }

  // Pick a fresh topic
  const topic = pickTopic(state.lastTopics || []);
  log(`MKT1 topic: ${topic}`);

  // Generate copy
  const copy = await generateCopy(topic);
  log(`MKT1 copy generated. X: ${copy.xPost.length} chars, Truth: ${copy.truthPost.length} chars`);

  // Generate image
  const image = await generateImage(topic);
  if (image) {
    log(`MKT1 image generated: ${image.mimeType} (${Math.round(image.base64.length * 0.75 / 1024)}KB)`);
  }

  // Post to platforms
  const results = [];

  if (twitterToken()) {
    const xResult = await postToX(copy.xPost);
    results.push({ platform: "x", ...xResult });
    log(`MKT1 X post: ${xResult.ok ? "✅" : "❌"} ${xResult.id || xResult.error || ""}`);
  }

  if (truthToken()) {
    const truthResult = await postToTruth(copy.truthPost);
    results.push({ platform: "truth", ...truthResult });
    log(`MKT1 Truth post: ${truthResult.ok ? "✅" : "❌"} ${truthResult.id || truthResult.error || ""}`);
  }

  if (results.length === 0) {
    log("MKT1 no platforms configured — skipping post");
    return { processed: 0, notes: "no platform tokens configured", copy, imageGenerated: !!image };
  }

  // Update state
  state.postsToday = [
    ...(todayPosts || []),
    { date: today, topic, platforms: results.map((r) => r.platform), ts: new Date().toISOString() },
  ];
  state.lastTopics = [...(state.lastTopics || []).slice(-19), topic];
  state.totalPosts = (state.totalPosts || 0) + results.filter((r) => r.ok).length;
  state.lastRun.MKT1 = new Date().toISOString();
  saveState(state);

  const successCount = results.filter((r) => r.ok).length;
  if (successCount > 0) {
    try {
      await textBen(`📣 Auto-posted to ${successCount} platform(s): "${topic.slice(0, 60)}..."`);
    } catch {}
  }

  return {
    processed: results.length,
    posted: successCount,
    topic,
    imageGenerated: !!image,
    results,
  };
}

// ── MKT2: Content Recycler ──────────────────────────────────────────────────

const BLOG_POSTS_TO_PROMOTE = [
  { title: "Why American-Made Vitamins Matter", url: "https://usagummies.com/blog/why-american-made-vitamins-matter" },
  { title: "The Science Behind Gummy Vitamins", url: "https://usagummies.com/blog/science-behind-gummy-vitamins" },
  { title: "How to Choose the Best Gummy Vitamins", url: "https://usagummies.com/blog/how-to-choose-best-gummy-vitamins" },
  { title: "Health Benefits of Daily Vitamin Supplements", url: "https://usagummies.com/blog/health-benefits-daily-vitamins" },
  { title: "Our Manufacturing Process", url: "https://usagummies.com/blog/our-manufacturing-process" },
];

async function recycleContent() {
  const state = loadState();
  const today = todayET();

  const todayPosts = (state.postsToday || []).filter((p) => p.date === today);
  if (todayPosts.length >= 3) {
    log("MKT2 skipped: daily limit reached");
    return { processed: 0, notes: "daily limit reached" };
  }

  // Pick a blog post to promote
  const idx = Math.floor(Math.random() * BLOG_POSTS_TO_PROMOTE.length);
  const post = BLOG_POSTS_TO_PROMOTE[idx];

  const copy = await generateCopy(`Check out our latest blog: "${post.title}" — ${post.url}`);

  const results = [];
  if (twitterToken()) {
    const xResult = await postToX(copy.xPost);
    results.push({ platform: "x", ...xResult });
  }
  if (truthToken()) {
    const truthResult = await postToTruth(copy.truthPost);
    results.push({ platform: "truth", ...truthResult });
  }

  state.postsToday = [
    ...todayPosts,
    { date: today, topic: `blog: ${post.title}`, platforms: results.map((r) => r.platform), ts: new Date().toISOString() },
  ];
  state.totalPosts = (state.totalPosts || 0) + results.filter((r) => r.ok).length;
  state.lastRun.MKT2 = new Date().toISOString();
  saveState(state);

  log(`MKT2 recycled blog post: ${post.title} → ${results.filter((r) => r.ok).length} posted`);
  return { processed: results.length, posted: results.filter((r) => r.ok).length, blog: post.title };
}

// ── MKT3: Auto-Post History Reporter ────────────────────────────────────────

async function reportHistory() {
  const state = loadState();
  const today = todayET();
  const todayPosts = (state.postsToday || []).filter((p) => p.date === today);

  const summary = {
    date: today,
    postsToday: todayPosts.length,
    totalAllTime: state.totalPosts || 0,
    topicsUsed: todayPosts.map((p) => p.topic).join("; "),
    lastTopics: (state.lastTopics || []).slice(-5),
  };

  state.lastRun.MKT3 = new Date().toISOString();
  saveState(state);

  log(`MKT3 report: ${todayPosts.length} posts today, ${state.totalPosts || 0} all-time`);

  try {
    await textBen(
      `📊 Marketing Report: ${todayPosts.length} post(s) today, ${state.totalPosts || 0} total all-time`,
    );
  } catch {}

  return { processed: 1, ...summary };
}

// ── Agent dispatch map ──────────────────────────────────────────────────────

const AGENTS = {
  MKT1: dailyPost,
  MKT2: recycleContent,
  MKT3: reportHistory,
};

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || "help";
  const arg = process.argv[3] || "";
  const source = process.argv.includes("--cron") ? "cron" : "manual";

  if (cmd === "status") {
    const state = loadState();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (cmd === "run") {
    const target = (arg || "").toUpperCase() || "ALL";

    if (target === "ALL") {
      for (const [key, handler] of Object.entries(AGENTS)) {
        try {
          await engine.runSingleAgentWithMonitoring(key, handler, { source });
        } catch (err) {
          log(`${key} failed: ${err?.message || err}`);
        }
      }
      console.log(JSON.stringify({ ok: true, ran: Object.keys(AGENTS) }, null, 2));
      return;
    }

    if (!AGENTS[target]) {
      throw new Error(`Unknown agent: ${target}. Valid: ${Object.keys(AGENTS).join(", ")}`);
    }

    const result = await engine.runSingleAgentWithMonitoring(target, AGENTS[target], { source });
    console.log(JSON.stringify({ ok: true, key: target, result }, null, 2));
    return;
  }

  if (cmd === "help") {
    console.log("Usage: node scripts/usa-gummies-marketing-autopost.mjs run MKT1|MKT2|MKT3|all | status");
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(async (err) => {
  log(`fatal: ${err?.message || err}`);
  try {
    await textBen(`🔴 Marketing auto-post engine failed: ${err?.message || err}`);
  } catch {}
  process.exit(1);
});
