#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { routeMessage } from "../src/lib/ops/operator/deterministic-router.ts";

const ROUTER_TESTS = [
  { msg: "rev", expect: "query_kpi_revenue" },
  { msg: "revenue", expect: "query_kpi_revenue" },
  { msg: "cash", expect: "query_plaid_balance" },
  { msg: "pnl", expect: "query_qbo_pnl" },
  { msg: "p&l", expect: "query_qbo_pnl" },
  { msg: "vendors", expect: "query_qbo_vendors" },
  { msg: "tasks", expect: "query_operator_tasks" },
  { msg: "approve", expect: "query_pending_approvals" },
  { msg: "help", expect: "show_help" },
  { msg: "emails", expect: "check_email" },
  { msg: "review", expect: "show_review_transactions" },
  { msg: "show me the P&L", expect: "query_qbo_pnl" },
  { msg: "balance sheet", expect: "query_qbo_balance_sheet" },
  { msg: "chart of accounts", expect: "query_qbo_accounts" },
  { msg: "what vendors are set up", expect: "query_qbo_vendors" },
  { msg: "show me transactions", expect: "query_qbo_purchases" },
  { msg: "recent purchases", expect: "query_qbo_purchases" },
  { msg: "bills", expect: "query_qbo_bills" },
  { msg: "invoices", expect: "query_qbo_invoices" },
  { msg: "cash flow", expect: "query_qbo_cash_flow" },
  { msg: "categorize Anthropic to software", expect: "categorize_qbo_transaction" },
  { msg: "create a vendor for EcoEnclose", expect: "create_qbo_vendor" },
  { msg: "add customer Walmart", expect: "create_qbo_customer" },
  { msg: "export vendor list as Excel", expect: "generate_file" },
  { msg: "send me an Excel of transactions", expect: "generate_file" },
  { msg: "check my email", expect: "search_email" },
  { msg: "any new emails", expect: "search_email" },
  { msg: "draft a reply to Greg", expect: "draft_email_reply" },
  { msg: "teach: the sky is blue", expect: "create_brain_entry" },
  { msg: "correct: COGS is $1.50", expect: "correct_brain_entry" },
  { msg: "what should I focus on today", expect: "query_priority_actions" },
  { msg: "compare our margins to SmartSweets", expect: null },
  { msg: "how are things going", expect: null },
  { msg: "tell me about the Powers meeting", expect: null },
  { msg: "what is the weather in Spokane", expect: null },
  { msg: "", expect: null },
  { msg: "?", expect: "show_help" },
  { msg: "ok", expect: null },
  { msg: "thanks", expect: null },
  { msg: "a]]]}{{{", expect: null },
];

const PO_TESTS = [
  { msg: "pos", expect(reply) { return /009180/.test(reply) && /140812/.test(reply); } },
  { msg: "open pos", expect(reply) { return /009180/.test(reply) && /140812/.test(reply); } },
  { msg: "orders", expect(reply) { return /009180/.test(reply) && /140812/.test(reply); } },
  { msg: "po 009180", expect(reply) { return /Inderbitzin/i.test(reply) && /009180/.test(reply); } },
  { msg: "po 140812", expect(reply) { return /Glacier|Mike Arlint/i.test(reply) && /140812/.test(reply); } },
  { msg: "po pipeline", expect(reply) { return /pipeline/i.test(reply) && /\$/.test(reply); } },
  { msg: "teach: shipped PO 009180 via USPS tracking 9400111899223456789012", expect(reply) { return /shipped/i.test(reply); } },
  { msg: "po 009180", expect(reply) { return /Status:\s*shipped/i.test(reply) && /9400111899223456789012/.test(reply); } },
  { msg: "teach: PO 009180 delivered", expect(reply) { return /delivered/i.test(reply) && /payment clock/i.test(reply); } },
  { msg: "po 009180", expect(reply) { return /Status:\s*delivered/i.test(reply); } },
];

const QUICK_TESTS = [
  { msg: "rev", maxMs: 2000, mustContain: "$" },
  { msg: "cash", maxMs: 2000, mustContain: "$" },
  { msg: "pnl", maxMs: 3000, mustContain: "Revenue" },
  { msg: "vendors", maxMs: 3000, mustContain: "vendor" },
  { msg: "tasks", maxMs: 2000 },
  { msg: "help", maxMs: 1000 },
];

function loadEnv() {
  const env = { ...process.env };
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, idx).trim()] = value;
  }
  return env;
}

const env = loadEnv();
const BASE_URL = process.argv[2] || "https://www.usagummies.com";
const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${env.CRON_SECRET}`,
};

async function postChat(message, actor = "ben", channel = "C0ALS6W7VB4") {
  const startedAt = Date.now();
  const res = await fetch(`${BASE_URL}/api/ops/abra/chat`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      message,
      channel: "slack",
      slack_channel_id: channel,
      actor_label: actor,
    }),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return {
    ok: res.ok,
    status: res.status,
    ms: Date.now() - startedAt,
    reply: String(json.reply || json.raw || ""),
  };
}

function parseScore(output, label) {
  const match = output.match(new RegExp(`${label}:\\s*(\\d+)\\/(\\d+)`, "i"));
  if (!match) return { passed: 0, total: 0 };
  return { passed: Number(match[1]), total: Number(match[2]) };
}

function runScript(script, args) {
  const result = spawnSync("node", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 8,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function runQuickCommands() {
  let passed = 0;
  for (const test of QUICK_TESTS) {
    const result = await postChat(test.msg);
    const ok = result.ok &&
      result.ms <= test.maxMs &&
      (!test.mustContain || result.reply.toLowerCase().includes(test.mustContain.toLowerCase()));
    console.log(`${ok ? "PASS" : "FAIL"} quick ${test.msg} | ms=${result.ms}`);
    if (!ok) console.log(`  reply=${result.reply.slice(0, 300)}`);
    if (ok) passed += 1;
  }
  return { passed, total: QUICK_TESTS.length };
}

async function runPoPipeline() {
  let passed = 0;
  for (const test of PO_TESTS) {
    const result = await postChat(test.msg, "ben", "C0ALS6W7VB4");
    const ok = result.ok && test.expect(result.reply);
    console.log(`${ok ? "PASS" : "FAIL"} po ${test.msg} | ms=${result.ms}`);
    if (!ok) console.log(`  reply=${result.reply.slice(0, 400)}`);
    if (ok) passed += 1;
  }
  return { passed, total: PO_TESTS.length };
}

function runRouterCoverage() {
  let passed = 0;
  for (const test of ROUTER_TESTS) {
    const routed = routeMessage(test.msg, "ben");
    const actual = routed?.action || null;
    const ok = actual === test.expect;
    console.log(`${ok ? "PASS" : "FAIL"} router ${JSON.stringify(test.msg)} -> ${actual}`);
    if (ok) passed += 1;
  }
  return { passed, total: ROUTER_TESTS.length };
}

async function main() {
  const quick = await runQuickCommands();
  const qboRun = runScript("scripts/test-qbo-verification.mjs", [BASE_URL]);
  process.stdout.write(qboRun.stdout);
  if (qboRun.stderr) process.stderr.write(qboRun.stderr);
  const qbo = parseScore(qboRun.stdout, "QBO verification score");

  const po = await runPoPipeline();

  const reneRun = runScript("scripts/test-rene-simulation.mjs", [BASE_URL, BASE_URL]);
  process.stdout.write(reneRun.stdout);
  if (reneRun.stderr) process.stderr.write(reneRun.stderr);
  const rene = parseScore(reneRun.stdout, "Rene simulation score");

  const benRun = runScript("scripts/test-full-day-ben.mjs", [BASE_URL]);
  process.stdout.write(benRun.stdout);
  if (benRun.stderr) process.stderr.write(benRun.stderr);
  const ben = parseScore(benRun.stdout, "Ben full-day score");

  const errorRun = runScript("scripts/test-error-recovery.mjs", [BASE_URL]);
  process.stdout.write(errorRun.stdout);
  if (errorRun.stderr) process.stderr.write(errorRun.stderr);
  const error = parseScore(errorRun.stdout, "Error recovery score");

  const operatorRun = runScript("scripts/test-operator-stability.mjs", [BASE_URL, "3"]);
  process.stdout.write(operatorRun.stdout);
  if (operatorRun.stderr) process.stderr.write(operatorRun.stderr);
  const operatorPassed = (/run 1 ok=true/.test(operatorRun.stdout) ? 1 : 0) +
    (/run 2 ok=true/.test(operatorRun.stdout) ? 1 : 0) +
    (/run 3 ok=true/.test(operatorRun.stdout) ? 1 : 0);
  const operator = { passed: operatorPassed, total: 3 };

  const router = runRouterCoverage();

  const totalPassed = quick.passed + qbo.passed + po.passed + rene.passed + ben.passed + error.passed + operator.passed + router.passed;
  const totalTests = quick.total + qbo.total + po.total + rene.total + ben.total + error.total + operator.total + router.total;

  console.log("");
  console.log("ABRA FULL INTEGRATION TEST — March 27, 2026");
  console.log("════════════════════════════════════════════");
  console.log(`Quick commands:     ${quick.passed}/${quick.total}`);
  console.log(`QBO verification:   ${qbo.passed}/${qbo.total}`);
  console.log(`PO pipeline:        ${po.passed}/${po.total}`);
  console.log(`Rene simulation:    ${rene.passed}/${rene.total}`);
  console.log(`Ben simulation:     ${ben.passed}/${ben.total}`);
  console.log(`Error recovery:     ${error.passed}/${error.total}`);
  console.log(`Operator stability: ${operator.passed}/${operator.total}`);
  console.log(`Router coverage:    ${router.passed}/${router.total}`);
  console.log("════════════════════════════════════════════");
  console.log(`TOTAL: ${totalPassed}/${totalTests}`);
  console.log("════════════════════════════════════════════");

  if (totalPassed < 100 || totalTests !== 107) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
