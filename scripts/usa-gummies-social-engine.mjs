#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  safeJsonRead,
  safeJsonWrite,
  fetchWithTimeout,
  nowETTimestamp,
  textBen,
} from "./lib/usa-gummies-shared.mjs";

const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const STATE_FILE = path.join(CONFIG_DIR, "social-engine-state.json");

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

function log(msg) {
  console.log(`[${nowETTimestamp()}] [social-engine] ${msg}`);
}

function twitterToken() {
  return process.env.TWITTER_ACCESS_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
}

function twitterUserId() {
  return process.env.TWITTER_USER_ID || "";
}

function truthToken() {
  return process.env.TRUTHSOCIAL_ACCESS_TOKEN || "";
}

async function monitorX(state) {
  const token = twitterToken();
  const userId = twitterUserId();
  if (!token || !userId) {
    log("SOC1 skipped: Twitter credentials missing");
    return { scanned: 0 };
  }

  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id,conversation_id",
    max_results: "25",
  });
  if (state.xSinceId) params.set("since_id", state.xSinceId);

  const res = await fetchWithTimeout(`https://api.twitter.com/2/users/${userId}/mentions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 20000);

  if (!res.ok) {
    log(`SOC1 Twitter mentions failed: ${res.status}`);
    return { scanned: 0 };
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

  log(`SOC1 monitored X mentions: ${mentions.length}`);
  return { scanned: mentions.length };
}

async function monitorTruth(state) {
  const token = truthToken();
  if (!token) {
    log("SOC2 skipped: Truth Social token missing");
    return { scanned: 0 };
  }

  const params = new URLSearchParams({ limit: "40" });
  if (state.truthSinceId) params.set("since_id", state.truthSinceId);

  const res = await fetchWithTimeout(`https://truthsocial.com/api/v1/notifications?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 20000);

  if (!res.ok) {
    log(`SOC2 Truth notifications failed: ${res.status}`);
    return { scanned: 0 };
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

  log(`SOC2 monitored Truth mentions: ${mentions.length}`);
  return { scanned: mentions.length };
}

async function postTwitterReply(tweetId, text) {
  const token = twitterToken();
  if (!token) return false;

  const res = await fetchWithTimeout("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: tweetId } }),
  }, 20000);
  return res.ok;
}

async function postTruthReply(statusId, text) {
  const token = truthToken();
  if (!token) return false;
  const res = await fetchWithTimeout("https://truthsocial.com/api/v1/statuses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: text, in_reply_to_id: statusId }),
  }, 20000);
  return res.ok;
}

async function generateReply(text) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) {
    return "Thanks for reaching out to USA Gummies. We appreciate your support and will follow up shortly.";
  }

  const system = "You are USA Gummies social support. Keep replies friendly, short, and non-political. No competitor attacks.";
  const user = `Write a short reply to this mention: ${text}`;

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }, 30000);

  if (!res.ok) {
    return "Thanks for reaching out to USA Gummies. We appreciate your support and will follow up shortly.";
  }

  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || "Thanks for reaching out to USA Gummies.";
}

async function trackPerformance(state) {
  const today = new Date().toISOString().slice(0, 10);
  const responses = Object.values(state.responsesToday || {}).filter((entry) => String(entry.date || "") === today).length;
  log(`SOC3 performance snapshot: responses today ${responses}`);
  return { responses };
}

async function autoRespond(state) {
  const pending = (state.mentionQueue || []).filter((m) => !m.responded).slice(0, 10);
  let sent = 0;

  for (const mention of pending) {
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
      state.responsesToday[mention.id] = { date: new Date().toISOString().slice(0, 10), platform: mention.platform };
      sent += 1;
    }
  }

  log(`SOC4 auto-responder sent: ${sent}`);
  return { sent };
}

async function runAgent(agentKey) {
  const state = loadState();

  if (agentKey === "SOC1") {
    const result = await monitorX(state);
    state.lastRun.SOC1 = new Date().toISOString();
    saveState(state);
    return result;
  }

  if (agentKey === "SOC2") {
    const result = await monitorTruth(state);
    state.lastRun.SOC2 = new Date().toISOString();
    saveState(state);
    return result;
  }

  if (agentKey === "SOC3") {
    const result = await trackPerformance(state);
    state.lastRun.SOC3 = new Date().toISOString();
    saveState(state);
    return result;
  }

  if (agentKey === "SOC4") {
    const result = await autoRespond(state);
    state.lastRun.SOC4 = new Date().toISOString();
    saveState(state);
    return result;
  }

  if (agentKey === "all") {
    await monitorX(state);
    await monitorTruth(state);
    await trackPerformance(state);
    await autoRespond(state);
    state.lastRun.SOC1 = new Date().toISOString();
    state.lastRun.SOC2 = new Date().toISOString();
    state.lastRun.SOC3 = new Date().toISOString();
    state.lastRun.SOC4 = new Date().toISOString();
    saveState(state);
    return { ok: true };
  }

  throw new Error(`Unknown agent key: ${agentKey}`);
}

async function main() {
  const cmd = process.argv[2] || "help";
  const arg = process.argv[3] || "";

  if (cmd === "status") {
    const state = loadState();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (cmd === "run") {
    const target = (arg || "").toUpperCase() || "ALL";
    const key = target === "ALL" ? "all" : target;
    const result = await runAgent(key);
    console.log(JSON.stringify({ ok: true, key, result }, null, 2));
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
