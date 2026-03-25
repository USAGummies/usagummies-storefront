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

function containsAll(text, checks) {
  const haystack = String(text || "").toLowerCase();
  return checks.every((check) => haystack.includes(check.toLowerCase()));
}

function classifyTiming(ms) {
  if (ms < 10000) return "good";
  if (ms < 20000) return "ok";
  return "bad";
}

function runSlackResponderBatch(messages) {
  const inputPath = path.join(os.tmpdir(), `rene-day-${Date.now()}.json`);
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
  { name: "good morning", action: false, validate: (reply) => containsAll(reply, ["good", "morning"]) || containsAll(reply, ["today"]) },
  { name: "pnl", action: false, validate: (reply) => containsAll(reply, ["revenue"]) && containsAll(reply, ["net"]) },
  { name: "cash", action: false, validate: (reply) => /\$[\d,]+/.test(reply) },
  { name: "rev", action: false, validate: (reply) => containsAll(reply, ["mtd"]) && /\$[\d,]+/.test(reply) },
  { name: "show me all uncategorized transactions", action: false, validate: (reply) => containsAll(reply, ["uncategorized"]) || containsAll(reply, ["review"]) || containsAll(reply, ["xlsx"]) },
  { name: "the Chase charge for $49.99 is Anthropic software", action: true, validate: (reply) => containsAll(reply, ["anthropic"]) && (containsAll(reply, ["fixed"]) || containsAll(reply, ["software"]) || containsAll(reply, ["got it"])) },
  { name: "categorize all Pirate Ship charges to shipping", action: true, validate: (reply) => containsAll(reply, ["pirate ship"]) && containsAll(reply, ["shipping"]) },
  { name: "vendors", action: false, validate: (reply) => /\b(albanese|anthropic|powers|belmark|pirate ship)\b/i.test(reply) },
  { name: "send me the chart of accounts as Excel", action: true, validate: (reply) => containsAll(reply, ["xlsx"]) || containsAll(reply, ["uploaded"]) || containsAll(reply, ["file"]) },
  { name: "what does the balance sheet look like", action: false, validate: (reply) => containsAll(reply, ["assets"]) || containsAll(reply, ["liabilities"]) || containsAll(reply, ["equity"]) },
  { name: "show me March P&L", action: false, validate: (reply) => containsAll(reply, ["revenue"]) && containsAll(reply, ["expenses"]) },
  { name: "how much do we owe vendors", action: false, validate: (reply) => containsAll(reply, ["owe"]) || containsAll(reply, ["accounts payable"]) || containsAll(reply, ["bills"]) },
  { name: "who owes us money", action: false, validate: (reply) => containsAll(reply, ["invoice"]) || containsAll(reply, ["receivable"]) || containsAll(reply, ["owes"]) },
  { name: "create an invoice for Inderbitzin, 500 units at $2.10", action: true, validate: (reply) => containsAll(reply, ["invoice"]) && (containsAll(reply, ["created"]) || containsAll(reply, ["approval"]) || containsAll(reply, ["draft"])) },
  { name: "what is the investor loan balance", action: false, validate: (reply) => /\$100,?000|\$100k/i.test(reply) || containsAll(reply, ["investor loan"]) },
  { name: "what transactions happened this week", action: false, validate: (reply) => containsAll(reply, ["transactions"]) || /\$[\d,]+/.test(reply) },
  { name: "categorize the Google charge to advertising", action: true, validate: (reply) => containsAll(reply, ["google"]) && containsAll(reply, ["advertising"]) },
  { name: "tasks", action: false, validate: (reply) => containsAll(reply, ["pending"]) || containsAll(reply, ["tasks"]) },
  { name: "help", action: false, validate: (reply) => containsAll(reply, ["commands"]) || containsAll(reply, ["help"]) },
  { name: "generate a P&L report as Excel", action: true, validate: (reply) => containsAll(reply, ["xlsx"]) || containsAll(reply, ["uploaded"]) || containsAll(reply, ["file"]) },
  { name: "what is our burn rate", action: false, validate: (reply) => containsAll(reply, ["burn"]) || /\$[\d,]+/.test(reply) },
  { name: "how much cash runway do we have", action: false, validate: (reply) => containsAll(reply, ["runway"]) || containsAll(reply, ["months"]) || /\$[\d,]+/.test(reply) },
  { name: "what did Abra do overnight", action: false, validate: (reply) => containsAll(reply, ["overnight"]) || containsAll(reply, ["operator"]) || containsAll(reply, ["categorized"]) },
  { name: "emails", action: false, validate: (reply) => containsAll(reply, ["draft"]) || containsAll(reply, ["email"]) },
  { name: "approve", action: false, validate: (reply) => containsAll(reply, ["approval"]) || containsAll(reply, ["pending"]) || containsAll(reply, ["no pending"]) },
];

async function run() {
  console.log(`Rene full-day simulation base: ${BASE_URL}`);
  let passed = 0;
  const payload = tests.map((test) => ({
    text: test.name,
    user: "U0ALL27JM38",
    channel: "C0AKG9FSC2J",
    displayName: "Rene Gonzalez",
  }));
  const results = runSlackResponderBatch(payload);

  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    const result = results[index] || {};
    const reply = String(result.reply || "");
    const responded = Boolean(result.handled) && reply.trim().length > 0;
    const correct = responded && test.validate(result.reply);
    const timing = classifyTiming(result.ms);
    const actionTaken = !test.action || /(created|queued|recorded|categorized|uploaded|approval|draft|fixed|got it|updated)/i.test(reply);
    const pass = responded && correct && actionTaken && timing !== "bad";
    console.log(`${pass ? "PASS" : "FAIL"} ${test.name} | responded=${responded} correct=${correct} timing=${timing} action=${actionTaken} (${result.ms}ms)`);
    if (!pass) {
      console.log(`  reply=${reply.slice(0, 600)}`);
    } else {
      passed += 1;
    }
  }

  console.log("");
  console.log(`Rene full-day score: ${passed}/${tests.length}`);
  if (passed !== tests.length) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
