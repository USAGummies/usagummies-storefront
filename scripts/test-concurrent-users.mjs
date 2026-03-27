#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BASE_URL = process.argv[2] || "";

function readAllLocalEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).replace(/^"|"$/g, "");
    out[key] = value;
  }
  return out;
}

const tests = [
  { actor: "Ben", user: "U08JY86Q508", channel: "C0ALS6W7VB4", text: "I'm heading to Spokane now", mustContain: ["drive", "powers prep"] },
  { actor: "Ben", user: "U08JY86Q508", channel: "C0ALS6W7VB4", text: "what should I ask Greg about", mustContain: ["Greg", "questions"] },
  { actor: "Ben", user: "U08JY86Q508", channel: "C0ALS6W7VB4", text: "teach: Greg confirmed $0.35/unit for co-packing", mustContain: ["stored"] },
  { actor: "Ben", user: "U08JY86Q508", channel: "C0ALS6W7VB4", text: "what emails need responses today", mustContain: ["email", "response"] },
  { actor: "Ben", user: "U08JY86Q508", channel: "C0ALS6W7VB4", text: "what's our inventory position", mustContain: ["Inventory", "units"] },
  { actor: "Rene", user: "U0ALL27JM38", channel: "C0AKG9FSC2J", text: "pnl", mustContain: ["Revenue", "Net"] },
  { actor: "Rene", user: "U0ALL27JM38", channel: "C0AKG9FSC2J", text: "categorize Anthropic to software", mustContain: ["Anthropic", "software"] },
  { actor: "Rene", user: "U0ALL27JM38", channel: "C0AKG9FSC2J", text: "what did Abra do overnight", mustContain: ["operator", "overnight"] },
  { actor: "Rene", user: "U0ALL27JM38", channel: "C0AKG9FSC2J", text: "send me the chart of accounts as Excel", mustContain: ["xlsx"] },
  { actor: "Rene", user: "U0ALL27JM38", channel: "C0AKG9FSC2J", text: "review", mustContain: ["review", "row"] },
];

function containsAll(text, checks) {
  const value = String(text || "");
  return checks.every((check) => value.toLowerCase().includes(check.toLowerCase()));
}

async function runOne(test, localEnv) {
  if (/^https?:\/\//i.test(BASE_URL)) {
    const startedAt = Date.now();
    const cronSecret = localEnv.CRON_SECRET || "";
    const res = await fetch(`${BASE_URL}/api/ops/abra/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({
        message: test.text,
        channel: "slack",
        slack_channel_id: test.channel,
        actor_label: test.actor === "Ben" ? "Ben Stutman" : "Rene Gonzalez",
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    const reply = String(data.reply || "");
    const pass =
      res.ok &&
      reply.trim().length > 0 &&
      containsAll(reply, test.mustContain) &&
      (test.actor !== "Ben" || !reply.includes("Rene")) &&
      (test.actor !== "Rene" || !reply.includes("Ben"));
    return {
      ...test,
      pass,
      ms: Date.now() - startedAt,
      reply,
    };
  }

  const inputPath = path.join(os.tmpdir(), `concurrent-${test.user}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(inputPath, JSON.stringify({
    text: test.text,
    user: test.user,
    channel: test.channel,
    displayName: test.actor === "Ben" ? "Ben Stutman" : "Rene Gonzalez",
  }), "utf8");

  const startedAt = Date.now();
  try {
    const { stdout } = await execFileAsync("npx", ["--yes", "tsx", "scripts/run-slack-message.ts", inputPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...localEnv,
        NODE_OPTIONS: `--require=${path.join(process.cwd(), "scripts/mock-server-only.cjs")}`,
      },
      maxBuffer: 20 * 1024 * 1024,
    });
    const data = JSON.parse(stdout || "{}");
    const reply = String(data.reply || "");
    const pass =
      Boolean(data.handled) &&
      reply.trim().length > 0 &&
      containsAll(reply, test.mustContain) &&
      (test.actor !== "Ben" || !reply.includes("Rene")) &&
      (test.actor !== "Rene" || !reply.includes("Ben"));
    return {
      ...test,
      pass,
      ms: Date.now() - startedAt,
      reply,
    };
  } finally {
    fs.rmSync(inputPath, { force: true });
  }
}

async function main() {
  const localEnv = readAllLocalEnv();
  const results = await Promise.all(tests.map((test) => runOne(test, localEnv)));
  let passed = 0;

  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.actor}: ${result.text} (${result.ms}ms)`);
    if (!result.pass) {
      console.log(`  reply=${result.reply.slice(0, 500)}`);
    } else {
      passed += 1;
    }
  }

  const benMs = results.filter((item) => item.actor === "Ben").map((item) => item.ms);
  const reneMs = results.filter((item) => item.actor === "Rene").map((item) => item.ms);
  const avg = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

  console.log("");
  console.log(JSON.stringify({
    passed,
    total: results.length,
    avgBenMs: avg(benMs),
    avgReneMs: avg(reneMs),
  }, null, 2));

  if (passed !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
