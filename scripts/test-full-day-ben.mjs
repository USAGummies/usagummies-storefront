#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function readEnv(name) {
  const line = fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
}

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

const BASE_URL = process.argv[2] || "http://127.0.0.1:3353";

function containsAny(text, checks) {
  const haystack = String(text || "").toLowerCase();
  return checks.some((check) => haystack.includes(check.toLowerCase()));
}

function classifyTiming(ms) {
  if (ms < 10000) return "good";
  if (ms < 20000) return "ok";
  return "bad";
}

function runSlackResponderBatch(messages) {
  const inputPath = path.join(os.tmpdir(), `ben-day-${Date.now()}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(messages), "utf8");
  try {
    const localEnv = readAllLocalEnv();
    const output = execFileSync("npx", ["--yes", "tsx", "scripts/run-slack-message.ts", inputPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...localEnv,
        NODE_OPTIONS: `--require=${path.join(process.cwd(), "scripts/mock-server-only.cjs")}`,
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(output);
  } finally {
    fs.rmSync(inputPath, { force: true });
  }
}

const tests = [
  { name: "good morning", action: false, validate: (reply) => containsAny(reply, ["good morning", "today", "status"]) },
  { name: "what emails need responses today", action: false, validate: (reply) => containsAny(reply, ["email", "draft", "response"]) },
  { name: "draft a reply to Reid Mitchell about the landed costs", action: true, validate: (reply) => containsAny(reply, ["draft", "approval", "reid"]) },
  { name: "what's the company status", action: false, validate: (reply) => containsAny(reply, ["revenue", "inventory", "operator", "status"]) },
  { name: "how much did we sell yesterday", action: false, validate: (reply) => containsAny(reply, ["yesterday", "mtd", "$"]) },
  { name: "what's our inventory position", action: false, validate: (reply) => containsAny(reply, ["inventory", "units", "fba", "incoming"]) },
  { name: "teach: Andrew confirmed the shipment arrives Thursday", action: true, validate: (reply) => containsAny(reply, ["learned", "triggered", "shipment", "thursday"]) },
  { name: "prep me for the Powers meeting", action: true, validate: (reply) => containsAny(reply, ["powers", "meeting", "prep", "ready"]) },
  { name: "what would happen if we got 3 wholesale accounts at 1000 units per week each", action: false, validate: (reply) => containsAny(reply, ["wholesale", "units", "week", "revenue", "margin"]) },
  { name: "generate an investor update for Rene", action: true, validate: (reply) => containsAny(reply, ["investor update", "ready", "approval", "package"]) },
  { name: "what did the operator do today", action: false, validate: (reply) => containsAny(reply, ["operator", "categorized", "overnight", "tasks"]) },
  { name: "who hasn't responded to our distributor samples", action: false, validate: (reply) => containsAny(reply, ["sample", "distributor", "follow-up", "response"]) },
  { name: "what's our gross margin by channel", action: false, validate: (reply) => containsAny(reply, ["gross margin", "amazon", "shopify", "wholesale"]) },
  { name: "rev", action: false, validate: (reply) => containsAny(reply, ["mtd", "amazon", "shopify", "$"]) },
  { name: "what are the top 3 things I should do right now", action: false, validate: (reply) => containsAny(reply, ["1.", "2.", "3.", "top"]) || containsAny(reply, ["first", "second", "third"]) },
];

async function run() {
  console.log(`Ben full-day simulation base: ${BASE_URL}`);
  let passed = 0;
  const payload = tests.map((test) => ({
    text: test.name,
    user: "U08JY86Q508",
    channel: "C0ALS6W7VB4",
    displayName: "Ben Stutman",
  }));
  const results = runSlackResponderBatch(payload);

  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    const result = results[index] || {};
    const reply = String(result.reply || "");
    const responded = Boolean(result.handled) && reply.trim().length > 0;
    const correct = responded && test.validate(result.reply);
    const timing = classifyTiming(result.ms);
    const actionTaken = !test.action || /(created|queued|recorded|categorized|uploaded|approval|draft|ready|triggered)/i.test(reply);
    const pass = responded && correct && actionTaken && timing !== "bad";
    console.log(`${pass ? "PASS" : "FAIL"} ${test.name} | responded=${responded} correct=${correct} timing=${timing} action=${actionTaken} (${result.ms}ms)`);
    if (!pass) {
      console.log(`  reply=${reply.slice(0, 600)}`);
    } else {
      passed += 1;
    }
  }

  console.log("");
  console.log(`Ben full-day score: ${passed}/${tests.length}`);
  if (passed !== tests.length) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
