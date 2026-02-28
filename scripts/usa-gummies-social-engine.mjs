#!/usr/bin/env node
/**
 * USA Gummies — Social Intelligence Engine
 *
 * 4 autonomous agents that monitor social mentions, auto-respond,
 * and track engagement across X (Twitter) and Truth Social.
 *
 * Agents:
 *   SOC1 — X Mention Monitor           Every 30 min
 *   SOC2 — Truth Social Monitor        Every 30 min
 *   SOC3 — Social Performance Tracker  Daily 8:00 PM
 *   SOC4 — Auto-Responder              Sequence (after SOC1/SOC2)
 *
 * Usage:
 *   node scripts/usa-gummies-social-engine.mjs run SOC1
 *   node scripts/usa-gummies-social-engine.mjs run all
 *   node scripts/usa-gummies-social-engine.mjs status
 *   node scripts/usa-gummies-social-engine.mjs help
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
const STATE_FILE = path.join(CONFIG_DIR, "social-engine-state.json");

// ── Agent Registry ──────────────────────────────────────────────────────────

const IDS = {};

const SCHEDULE_PLAN = {
  SOC1: { label: "X Mention Monitor", cron: "*/30 * * * *", description: "Scans X (Twitter) for new mentions" },
  SOC2: { label: "Truth Social Monitor", cron: "*/30 * * * *", description: "Scans Truth Social for new mentions" },
  SOC3: { label: "Social Performance Tracker", cron: "0 20 * * *", description: "Daily engagement snapshot" },
  SOC4: { label: "Auto-Responder", cron: "sequence", description: "GPT-powered auto-replies to mentions" },
};

// ── Engine Bootstrap ────────────────────────────────────────────────────────

const engine = createEngine({
  name: "social-engine",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

const log = (msg) => engine.log(msg);

// ── Social State ────────────────────────────────────────────────────────────

function loadState() {
  return safeJsonRead(STATE_FILE, {
    xSinceId: null,
    truthSinceId: null,
    mentionQueue: [],
    responsesToday: {},
    lastRun: {},
  });
}

function saveState(state) {
  safeJsonWrite(STATE_FILE, state);
}

// ── Credential helpers ──────────────────────────────────────────────────────

function twitterToken() {
  return process.env.TWITTER_ACCESS_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
}

function twitterUserId() {
  return process.env.TWITTER_USER_ID || "";
}

function truthToken() {
  return process.env.TRUTHSOCIAL_ACCESS_TOKEN || "";
}

// ── SOC1: X Mention Monitor ────────────────────────────────────────────────

async function monitorX() {
  const state = loadState();
  const token = twitterToken();
  const userId = twitterUserId();
  if (!token || !userId) {
    log("SOC1 skipped: Twitter credentials missing");
    return { scanned: 0, status: "skipped", notes: "credentials missing" };
  }

  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id,conversation_id",
    max_results: "25",
  });
  if (state.xSinceId) params.set("since_id", state.xSinceId);

  const res = await fetchWithTimeout(
    `https://api.twitter.com/2/users/${userId}/mentions?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
    20000,
  );

  if (!res.ok) {
    log(`SOC1 Twitter mentions failed: ${res.status}`);
    return { scanned: 0, status: "failed", notes: `API ${res.status}` };
  }

  const json = await res.json();
  const mentions = json.data || [];
  for (const mention of mentions) {
    state.mentionQueue.push({
      platform: "x",
      id: mention.id,
      text: mention.text || "",
      createdAt: mention.created_at || new Date().toISOString(),
      responded: false,
    });
  }

  const newest = mentions[0]?.id;
  if (newest) state.xSinceId = newest;
  state.lastRun.SOC1 = new Date().toISOString();
  saveState(state);

  log(`SOC1 monitored X mentions: ${mentions.length}`);
  return { scanned: mentions.length, processed: mentions.length };
}

// ── SOC2: Truth Social Monitor ──────────────────────────────────────────────

async function monitorTruth() {
  const state = loadState();
  const token = truthToken();
  if (!token) {
    log("SOC2 skipped: Truth Social token missing");
    return { scanned: 0, status: "skipped", notes: "credentials missing" };
  }

  const params = new URLSearchParams({ limit: "40" });
  if (state.truthSinceId) params.set("since_id", state.truthSinceId);

  const res = await fetchWithTimeout(
    `https://truthsocial.com/api/v1/notifications?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
    20000,
  );

  if (!res.ok) {
    log(`SOC2 Truth notifications failed: ${res.status}`);
    return { scanned: 0, status: "failed", notes: `API ${res.status}` };
  }

  const items = await res.json();
  const mentions = (items || []).filter((item) => String(item.type || "") === "mention");

  for (const mention of mentions) {
    const status = mention.status || {};
    state.mentionQueue.push({
      platform: "truth",
      id: status.id || mention.id,
      text: status.content || "",
      createdAt: status.created_at || new Date().toISOString(),
      responded: false,
    });
  }

  const newest = mentions[0]?.id;
  if (newest) state.truthSinceId = newest;
  state.lastRun.SOC2 = new Date().toISOString();
  saveState(state);

  log(`SOC2 monitored Truth mentions: ${mentions.length}`);
  return { scanned: mentions.length, processed: mentions.length };
}

// ── Reply helpers ───────────────────────────────────────────────────────────

async function postTwitterReply(tweetId, text) {
  const token = twitterToken();
  if (!token) return false;

  const res = await fetchWithTimeout(
    "https://api.twitter.com/2/tweets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: tweetId } }),
    },
    20000,
  );
  return res.ok;
}

async function postTruthReply(statusId, text) {
  const token = truthToken();
  if (!token) return false;
  const res = await fetchWithTimeout(
    "https://truthsocial.com/api/v1/statuses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: text, in_reply_to_id: statusId }),
    },
    20000,
  );
  return res.ok;
}

async function generateReply(text) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) {
    return "Thanks for reaching out to USA Gummies! We appreciate your support and will follow up shortly. 🇺🇸";
  }

  const system =
    "You are USA Gummies social support. Keep replies friendly, short (under 200 chars), and non-political. " +
    "No competitor attacks. Be patriotic and health-conscious. Use an emoji occasionally.";
  const user = `Write a short reply to this social media mention: "${text}"`;

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
        temperature: 0.5,
        max_tokens: 100,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    },
    30000,
  );

  if (!res.ok) {
    return "Thanks for reaching out to USA Gummies! We appreciate your support. 🇺🇸";
  }

  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || "Thanks for reaching out to USA Gummies! 🇺🇸";
}

// ── SOC3: Social Performance Tracker ────────────────────────────────────────

async function trackPerformance() {
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);
  const responsesTodayCount = Object.values(state.responsesToday || {}).filter(
    (entry) => String(entry.date || "") === today,
  ).length;
  const totalPending = (state.mentionQueue || []).filter((m) => !m.responded).length;
  const totalResponded = (state.mentionQueue || []).filter((m) => m.responded).length;

  state.lastRun.SOC3 = new Date().toISOString();
  saveState(state);

  log(`SOC3 performance: responses today=${responsesTodayCount}, pending=${totalPending}, total responded=${totalResponded}`);
  return {
    processed: 1,
    notes: `responses_today=${responsesTodayCount} pending=${totalPending} responded=${totalResponded}`,
  };
}

// ── SOC4: Auto-Responder ────────────────────────────────────────────────────

async function autoRespond() {
  const state = loadState();
  const pending = (state.mentionQueue || []).filter((m) => !m.responded).slice(0, 10);
  let sent = 0;
  const errors = [];

  for (const mention of pending) {
    try {
      const reply = await generateReply(String(mention.text || ""));
      let ok = false;
      if (mention.platform === "x") {
        ok = await postTwitterReply(mention.id, reply);
      } else if (mention.platform === "truth") {
        ok = await postTruthReply(mention.id, reply);
      }

      if (ok) {
        mention.responded = true;
        mention.respondedAt = new Date().toISOString();
        mention.replyText = reply;
        state.responsesToday[mention.id] = {
          date: new Date().toISOString().slice(0, 10),
          platform: mention.platform,
        };
        sent += 1;
      }
    } catch (err) {
      errors.push(`${mention.platform}:${mention.id}: ${err?.message || err}`);
    }
  }

  // Trim old mention queue entries (keep last 500)
  if (state.mentionQueue.length > 500) {
    state.mentionQueue = state.mentionQueue.slice(-500);
  }

  // Reset responsesToday if date changed
  const today = new Date().toISOString().slice(0, 10);
  const cleaned = {};
  for (const [k, v] of Object.entries(state.responsesToday || {})) {
    if (v?.date === today) cleaned[k] = v;
  }
  state.responsesToday = cleaned;

  state.lastRun.SOC4 = new Date().toISOString();
  saveState(state);

  log(`SOC4 auto-responder sent: ${sent}${errors.length ? ` (${errors.length} errors)` : ""}`);
  return { sent, processed: pending.length, errors: errors.length ? errors : undefined };
}

// ── Agent dispatch map ──────────────────────────────────────────────────────

const AGENTS = {
  SOC1: monitorX,
  SOC2: monitorTruth,
  SOC3: trackPerformance,
  SOC4: autoRespond,
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
    console.log("Usage: node scripts/usa-gummies-social-engine.mjs run SOC1|SOC2|SOC3|SOC4|all | status");
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(async (err) => {
  log(`fatal: ${err?.message || err}`);
  try {
    await textBen(`🔴 Social engine failed: ${err?.message || err}`);
  } catch {}
  process.exit(1);
});
