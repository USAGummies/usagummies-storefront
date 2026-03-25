#!/usr/bin/env node

import fs from "node:fs";

function loadEnvFile() {
  const env = { ...process.env };
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return env;
}

async function slackHistory(token, channel, oldest) {
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", "200");
  if (oldest) url.searchParams.set("oldest", oldest);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function supabaseGet(baseUrl, key, path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const env = loadEnvFile();
  const base = process.argv[2] || "http://127.0.0.1:3356";
  const runsTarget = Number(process.argv[3] || "5");
  const slackChannel = "C0ALS6W7VB4";
  const startTs = String(Date.now() / 1000 - 2);

  const beforeHistory = await slackHistory(env.SLACK_BOT_TOKEN, slackChannel, startTs);
  const beforeCount = Array.isArray(beforeHistory.messages)
    ? beforeHistory.messages.filter((message) =>
        String(message.text || "").includes("Abra Operator Cycle"),
      ).length
    : 0;

  const runs = [];
  for (let index = 0; index < runsTarget; index += 1) {
    const started = Date.now();
    const res = await fetch(`${base}/api/ops/abra/operator`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(180000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Non-JSON operator response on run ${index + 1}: ${text.slice(0, 500)}`);
    }
    const ms = Date.now() - started;
    runs.push({ index: index + 1, ms, ok: res.ok, ...data });
    console.log(
      `run ${index + 1} ok=${res.ok} ms=${ms} failures=${data?.execution?.failed ?? "n/a"} completed=${data?.execution?.completed ?? "n/a"}`,
    );
    if (index < runsTarget - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  const afterHistory = await slackHistory(env.SLACK_BOT_TOKEN, slackChannel, startTs);
  const cycleMessages = Array.isArray(afterHistory.messages)
    ? afterHistory.messages.filter((message) =>
        String(message.text || "").includes("Abra Operator Cycle"),
      ).length - beforeCount
    : null;

  const dupRows = await supabaseGet(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    "/rest/v1/abra_operator_tasks?select=natural_key,status",
  );
  const keys = Array.isArray(dupRows)
    ? dupRows.map((row) => String(row.natural_key || "")).filter(Boolean)
    : [];
  const duplicateNaturalKeys = keys.length - new Set(keys).size;

  console.log(
    "FINAL " +
      JSON.stringify(
        {
          runs,
          cycleMessages,
          duplicateNaturalKeys,
        },
        null,
        2,
      ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
