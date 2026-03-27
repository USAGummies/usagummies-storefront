#!/usr/bin/env node

import fs from "node:fs";

const RENE_WEDNESDAY = [
  { msg: "good morning", expect: "finance_brief" },
  { msg: "show me uncategorized transactions", expect: "transaction_list_or_excel" },
  { msg: "the Chase charge for 19.99 is T-Mobile utilities", expect: "categorized_and_learned" },
  { msg: "categorize all Pirate Ship to shipping", expect: "batch_categorized" },
  { msg: "pnl", expect: "pnl_data" },
  { msg: "what's the loan balance", expect: "100k_reference" },
  { msg: "send me the full transaction list as Excel", expect: "file_uploaded" },
  { msg: "cash", expect: "plaid_balance" },
  { msg: "how many transactions are categorized vs uncategorized", expect: "qbo_health_stats" },
  { msg: "create a vendor for T-Mobile", expect: "vendor_created" },
  { msg: "what is our monthly burn rate", expect: "burn_rate_number" },
  { msg: "that $500 deposit from Rene is an investor loan", expect: "categorized_to_2300" },
  { msg: "vendors", expect: "vendor_list" },
  { msg: "what did Abra do overnight", expect: "operator_summary" },
  { msg: "help", expect: "command_list" },
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

function containsAny(text, checks) {
  const haystack = String(text || "").toLowerCase();
  return checks.some((check) => haystack.includes(check.toLowerCase()));
}

function validate(step, reply) {
  const text = String(reply || "");
  switch (step.expect) {
    case "finance_brief":
      return containsAny(text, ["good morning", "qbo", "operator", "review"]);
    case "transaction_list_or_excel":
      return containsAny(text, ["transactions needing review", "uncategorized", "xlsx", "review"]);
    case "categorized_and_learned":
      return containsAny(text, ["t-mobile", "utilities", "got it", "fixed", "categorized"]);
    case "batch_categorized":
      return containsAny(text, ["pirate ship", "shipping"]);
    case "pnl_data":
      return containsAny(text, ["revenue", "cogs", "expenses", "net"]);
    case "100k_reference":
      return /\$100,?000|\$100k/i.test(text) || containsAny(text, ["investor loan"]);
    case "file_uploaded":
      return containsAny(text, ["xlsx", "uploaded", "file"]);
    case "plaid_balance":
      return /\$[\d,]+/.test(text);
    case "qbo_health_stats":
      return containsAny(text, ["categorized", "uncategorized", "qbo health"]);
    case "vendor_created":
      return containsAny(text, ["t-mobile", "created", "vendor", "already exists"]);
    case "burn_rate_number":
      return containsAny(text, ["burn rate", "month"]) && /\$[\d,]+/.test(text);
    case "categorized_to_2300":
      return containsAny(text, ["investor loan", "rene", "got it", "categorized"]);
    case "vendor_list":
      return containsAny(text, ["vendor", "powers", "albanese", "pirate ship"]);
    case "operator_summary":
      return containsAny(text, ["overnight", "operator", "categorized", "tasks"]);
    case "command_list":
      return containsAny(text, ["commands", "help", "rev", "cash"]);
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
      slack_channel_id: "C0AKG9FSC2J",
      actor_label: "rene",
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
for (const step of RENE_WEDNESDAY) {
  const result = await postChat(step.msg);
  const ok = result.ok && validate(step, result.reply);
  console.log(`${ok ? "PASS" : "FAIL"} ${step.msg} | expect=${step.expect} ms=${result.ms}`);
  if (!ok) console.log(`  reply=${result.reply.slice(0, 600)}`);
  if (ok) passed += 1;
}

console.log(`Rene Wednesday score: ${passed}/${RENE_WEDNESDAY.length}`);
if (passed !== RENE_WEDNESDAY.length) process.exit(1);
