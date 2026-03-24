#!/usr/bin/env node

import fs from "node:fs";

function readEnv(name) {
  const line = fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
}

const CHANNEL_ID = "C0AKG9FSC2J";
const BASE_URL = process.argv[2] || "https://www.usagummies.com";
const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const SLACK_BOT_TOKEN = readEnv("SLACK_BOT_TOKEN");
const BOT_USER_ID = "U0AKMSTL0GL";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SLACK_BOT_TOKEN) {
  console.error("Missing SUPABASE or SLACK env vars in .env.local");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function slackHistory(oldestTs) {
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", CHANNEL_ID);
  url.searchParams.set("oldest", String(oldestTs));
  url.searchParams.set("limit", "20");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
  });
  return res.json();
}

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function run() {
  const posted = await slackApi("chat.postMessage", {
    channel: CHANNEL_ID,
    text: "🧪 Abra events test — please ignore",
  });
  if (!posted.ok || !posted.ts) {
    console.error(`FAIL could not post Slack test message (${posted.error || "unknown"})`);
    process.exit(1);
  }

  await sleep(5000);

  const history = await slackHistory(Number(posted.ts) - 1);
  const selfReplies = Array.isArray(history.messages)
    ? history.messages.filter((message) =>
        message.thread_ts === posted.ts &&
        message.ts !== posted.ts &&
        (message.user === BOT_USER_ID || message.bot_id),
      )
    : [];

  const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const answerLog = await supabase(
    `/rest/v1/abra_answer_log?select=id,channel,asked_by,created_at&channel=eq.slack&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=20`,
  );

  const recentSlackAnswers = Array.isArray(answerLog) ? answerLog.length : 0;
  const status =
    recentSlackAnswers > 0
      ? "Slack events path: VERIFIED"
      : "Slack events path: NO RECENT ACTIVITY — events may not be reaching the handler";

  console.log(`PASS bot self-response check (self replies=${selfReplies.length})`);
  console.log(`PASS recent slack answer log rows=${recentSlackAnswers}`);
  console.log(status);

  await slackApi("chat.delete", { channel: CHANNEL_ID, ts: posted.ts }).catch(() => {});

  if (selfReplies.length > 0) {
    console.error("FAIL bot message triggered a bot reply");
    process.exit(1);
  }

  if (recentSlackAnswers === 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
