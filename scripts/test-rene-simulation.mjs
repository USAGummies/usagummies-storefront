#!/usr/bin/env node

import fs from "node:fs";

function readEnv(name) {
  const line = fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
}

const CHAT_BASE_URL = process.argv[2] || "https://www.usagummies.com";
const OPERATOR_BASE_URL = process.argv[3] || process.argv[2] || "http://127.0.0.1:3338";
const CRON_SECRET = readEnv("CRON_SECRET");
const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const SLACK_BOT_TOKEN = readEnv("SLACK_BOT_TOKEN");
const ABRA_CONTROL_CHANNEL = readEnv("SLACK_CHANNEL_ALERTS") || "C0ALS6W7VB4";

if (!CRON_SECRET) {
  console.error("CRON_SECRET missing from .env.local");
  process.exit(1);
}

const authHeaders = {
  Authorization: `Bearer ${CRON_SECRET}`,
  "Content-Type": "application/json",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChat(message) {
  const start = Date.now();
  const res = await fetch(`${CHAT_BASE_URL}/api/ops/abra/chat`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      message,
      history: [],
      channel: "slack",
      slack_channel_id: "C0AKG9FSC2J",
      actor_label: "rene",
    }),
  });
  const text = await res.text();
  const ms = Date.now() - start;
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, ms, json, text };
}

function containsAll(text, checks) {
  const haystack = String(text || "").toLowerCase();
  return checks.every((check) => haystack.includes(check.toLowerCase()));
}

const tests = [
  {
    name: "show me the P&L",
    expect(reply) {
      return containsAll(reply, ["revenue"]) && (containsAll(reply, ["expense"]) || containsAll(reply, ["income"]));
    },
  },
  {
    name: "send me an Excel of all transactions",
    expect(reply) {
      return containsAll(reply, ["xlsx"]) || containsAll(reply, ["uploaded"]);
    },
  },
  {
    name: "what is the cash position",
    expect(reply) {
      return /\$[\d,]+/.test(String(reply || ""));
    },
  },
  {
    name: "how do I see all the transactions",
    expect(reply) {
      return containsAll(reply, ["transaction"]) && (
        containsAll(reply, ["ops"]) ||
        containsAll(reply, ["dashboard"]) ||
        containsAll(reply, ["download"]) ||
        containsAll(reply, ["quickbooks"]) ||
        containsAll(reply, ["qbo"]) ||
        containsAll(reply, ["reports"])
      );
    },
  },
  {
    name: "categorize the Anthropic charge to software",
    expect(reply) {
      return containsAll(reply, ["anthropic"]) && (containsAll(reply, ["categor"]) || containsAll(reply, ["software"]));
    },
  },
  {
    name: "what vendors are set up",
    expect(reply) {
      return containsAll(reply, ["vendor"]) && /\b(albanese|anthropic|powers|belmark|pirate ship)\b/i.test(String(reply || ""));
    },
  },
  {
    name: "create a vendor for EcoEnclose",
    expect(reply) {
      return containsAll(reply, ["ecoenclose"]) && (containsAll(reply, ["created"]) || containsAll(reply, ["vendor"]));
    },
  },
  {
    name: "what is the balance on the investor loan",
    expect(reply) {
      return /\$100,?000|\$100k/i.test(String(reply || "")) || containsAll(reply, ["rene"]);
    },
  },
  {
    name: "send me the chart of accounts as Excel",
    expect(reply) {
      return containsAll(reply, ["xlsx"]) || containsAll(reply, ["uploaded"]);
    },
  },
  {
    name: "what needs my attention today",
    expect(reply) {
      return containsAll(reply, ["attention"]) || containsAll(reply, ["needs"]) || containsAll(reply, ["action"]);
    },
  },
];

async function getSlackCycleCount(oldestEpochSeconds) {
  if (!SLACK_BOT_TOKEN) return null;
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", ABRA_CONTROL_CHANNEL);
  url.searchParams.set("oldest", String(oldestEpochSeconds));
  url.searchParams.set("limit", "100");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok || !Array.isArray(json.messages)) return null;
  return json.messages.filter((message) => String(message.text || "").includes("Abra Operator Cycle")).length;
}

async function getOperatorTaskRows() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/abra_operator_tasks?select=id,task_type,status,completed_at,execution_params`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return res.json();
}

function duplicateNaturalKeys(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = row?.execution_params?.natural_key;
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

async function postOperator() {
  const start = Date.now();
  const res = await fetch(`${OPERATOR_BASE_URL}/api/ops/abra/operator`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, ms: Date.now() - start, json };
}

async function run() {
  console.log(`Chat base URL: ${CHAT_BASE_URL}`);
  console.log(`Operator base URL: ${OPERATOR_BASE_URL}`);
  console.log("");

  let passed = 0;
  for (const test of tests) {
    const result = await postChat(test.name);
    const reply = result.json?.reply || "";
    const ok = result.ok && test.expect(reply);
    console.log(`${ok ? "PASS" : "FAIL"} ${test.name} (${result.ms}ms)`);
    if (!ok) {
      console.log(`  status=${result.status}`);
      console.log(`  reply=${String(reply || result.text).slice(0, 500)}`);
    } else {
      passed += 1;
    }
  }

  console.log("");
  console.log(`Rene simulation score: ${passed}/${tests.length}`);
  if (passed !== tests.length) {
    process.exit(1);
  }

  const oldest = Math.floor(Date.now() / 1000);
  const beforeRows = await getOperatorTaskRows();
  const beforeCompleted = beforeRows.filter((row) => row.status === "completed").length;

  const operatorRuns = [];
  for (let index = 0; index < 3; index += 1) {
    const runResult = await postOperator();
    operatorRuns.push(runResult);
    console.log(`operator run ${index + 1}: ${runResult.ok ? "PASS" : "FAIL"} (${runResult.ms}ms)`);
    console.log(JSON.stringify(runResult.json));
    if (!runResult.ok) process.exit(1);
    if (index < 2) await sleep(5000);
  }

  const afterRows = await getOperatorTaskRows();
  const afterCompleted = afterRows.filter((row) => row.status === "completed").length;
  const dupes = duplicateNaturalKeys(afterRows);
  const cycleMessages = await getSlackCycleCount(oldest);

  const completedDelta = afterCompleted - beforeCompleted;
  const followupRunsStable = operatorRuns.slice(1).every((run) =>
    Number(run.json?.createdTasks || 0) === 0 &&
    Number(run.json?.execution?.completed || 0) === 0 &&
    Number(run.json?.execution?.failed || 0) === 0,
  );
  const idempotent = dupes.length === 0 && followupRunsStable;
  const slackOkay = cycleMessages === null ? true : cycleMessages <= 3;

  console.log("");
  console.log(`duplicate natural keys: ${dupes.length}`);
  console.log(`completed delta: ${completedDelta}`);
  console.log(`follow-up runs stable: ${followupRunsStable}`);
  console.log(`operator cycle messages in #abra-control: ${cycleMessages === null ? "unverified" : cycleMessages}`);

  if (!idempotent || !slackOkay) {
    console.error("Operator idempotency test failed");
    process.exit(1);
  }

  console.log("Operator idempotency: PASS");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
