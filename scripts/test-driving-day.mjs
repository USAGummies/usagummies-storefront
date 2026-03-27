#!/usr/bin/env node

import fs from "node:fs";

const DRIVING_DAY = [
  { msg: "good morning", expect: "morning_brief", delay: 0 },
  { msg: "prep", expect: "meeting_prep", delay: 500 },
  { msg: "I'm heading out to Spokane now", expect: "driving_mode_activated", delay: 500 },
  { msg: "what should I bring up with Greg", expect: "short_response_under_200_chars", delay: 500 },
  { msg: "any emails I need to know about", expect: "short_email_summary", delay: 500 },
  { msg: "what's our cash position", expect: "short_cash_answer", delay: 500 },
  { msg: "just talked to Andrew on the phone, shipment arrives Thursday", expect: "teach_acknowledged", delay: 500 },
  { msg: "rev", expect: "revenue_quick", delay: 500 },
  { msg: "has Rene messaged today", expect: "short_answer", delay: 500 },
  { msg: "just arrived at Powers, parked", expect: "driving_mode_deactivated_with_summary", delay: 500 },
  { msg: "meeting starting, going quiet for a couple hours", expect: "acknowledged", delay: 500 },
  { msg: "meeting is done, heading home", expect: "driving_mode_activated", delay: 500 },
  { msg: "Greg confirmed production starts April 15, 50K units, $0.35 per unit co-packing", expect: "teach_acknowledged_short", delay: 500 },
  { msg: "he needs the logo file and UPC barcode by Friday", expect: "teach_task_created", delay: 500 },
  { msg: "deposit is $8,750, I'll wire it tomorrow", expect: "teach_financial", delay: 500 },
  { msg: "I'm home", expect: "driving_mode_deactivated_with_summary", delay: 500 },
  { msg: "what happened while I was out today", expect: "full_day_summary", delay: 500 },
  { msg: "what does Rene need from me", expect: "rene_items", delay: 500 },
];

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return env;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsAny(text, checks) {
  const haystack = String(text || "").toLowerCase();
  return checks.some((check) => haystack.includes(check.toLowerCase()));
}

function validate(step, reply) {
  const text = String(reply || "");
  switch (step.expect) {
    case "morning_brief":
      return containsAny(text, ["powers meeting day", "say \"i'm driving\"", "greg quoted"]);
    case "meeting_prep":
      return containsAny(text, ["powers meeting prep", "greg", "questions for greg", "prep"]);
    case "driving_mode_activated":
      return text.length <= 200 && containsAny(text, ["driving mode is on", "drive safe"]);
    case "short_response_under_200_chars":
      return text.length <= 200 && containsAny(text, ["greg", "ask", "need"]);
    case "short_email_summary":
      return text.length <= 200 && containsAny(text, ["email", "response", "reply"]);
    case "short_cash_answer":
      return text.length <= 200 && /\$[\d,]+/.test(text);
    case "teach_acknowledged":
      return text.length <= 200 && containsAny(text, ["stored", "memory", "entity state"]);
    case "revenue_quick":
      return text.length <= 200 && containsAny(text, ["mtd", "amazon", "shopify", "$"]);
    case "short_answer":
      return text.length <= 200 && containsAny(text, ["rene", "today", "financials", "messaged"]);
    case "driving_mode_deactivated_with_summary":
      return containsAny(text, ["driving mode is off", "while you were driving", "powers prep"]);
    case "acknowledged":
      return containsAny(text, ["got it", "quiet", "drive safe", "powers prep"]);
    case "teach_acknowledged_short":
      return text.length <= 200 && containsAny(text, ["stored", "powers", "entity state", "memory"]);
    case "teach_task_created":
      return text.length <= 200 && containsAny(text, ["stored", "memory", "entity state"]);
    case "teach_financial":
      return text.length <= 200 && containsAny(text, ["stored", "memory", "entity state"]);
    case "full_day_summary":
      return containsAny(text, ["while you were out", "nothing urgent", "queued"]);
    case "rene_items":
      return containsAny(text, ["rene needs", "nothing", "approval", "pending"]);
    default:
      return false;
  }
}

const env = loadEnv();
const BASE_URL = process.argv[2] || "https://www.usagummies.com";
const headers = {
  "Content-Type": "application/json",
  ...(env.CRON_SECRET ? { Authorization: `Bearer ${env.CRON_SECRET}` } : {}),
};

async function postChat(message) {
  const startedAt = Date.now();
  const res = await fetch(`${BASE_URL}/api/ops/abra/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      channel: "slack",
      slack_channel_id: "C0ALS6W7VB4",
      actor_label: "ben",
    }),
    signal: AbortSignal.timeout(25000),
  });
  const payload = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    ms: Date.now() - startedAt,
    reply: String(payload.reply || ""),
    status: res.status,
  };
}

let passed = 0;
for (const step of DRIVING_DAY) {
  if (step.delay) await sleep(step.delay);
  const result = await postChat(step.msg);
  const ok = result.ok && validate(step, result.reply);
  console.log(`${ok ? "PASS" : "FAIL"} ${step.msg} | expect=${step.expect} ms=${result.ms}`);
  if (!ok) console.log(`  reply=${result.reply.slice(0, 600)}`);
  if (ok) passed += 1;
}

console.log(`Driving day score: ${passed}/${DRIVING_DAY.length}`);
if (passed !== DRIVING_DAY.length) process.exit(1);
