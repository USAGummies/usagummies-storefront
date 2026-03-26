import fs from "node:fs";

const STABLE_QUERIES = [
  { query: "rev", maxMs: 2000, mustContain: "$", category: "quick" },
  { query: "cash", maxMs: 2000, mustContain: "$", category: "quick" },
  { query: "pnl", maxMs: 3000, mustContain: "Revenue", category: "quick" },
  { query: "vendors", maxMs: 3000, mustContain: "vendor", category: "quick" },
  { query: "tasks", maxMs: 2000, category: "quick" },
  { query: "help", maxMs: 1000, category: "quick" },
  { query: "show me the P&L", maxMs: 10000, mustContain: "Revenue", category: "finance" },
  { query: "what is our cash position", maxMs: 10000, mustContain: "$", category: "finance" },
  { query: "balance sheet", maxMs: 10000, category: "finance" },
  { query: "what vendors are set up", maxMs: 10000, category: "finance" },
  { query: "show me recent transactions", maxMs: 10000, category: "finance" },
  { query: "what is our forward COGS per unit", maxMs: 15000, mustContain: "1.5", category: "knowledge" },
  { query: "how much has Rene invested", maxMs: 15000, mustContain: "100", category: "knowledge" },
  { query: "what is the shelf life", maxMs: 15000, mustContain: "18", category: "knowledge" },
  { query: "what is our priority order", maxMs: 15000, mustContain: "signal", category: "knowledge" },
  { query: "wholesale price for Inderbitzin", maxMs: 15000, mustContain: "2.10", category: "knowledge" },
  { query: "categorize the test charge to software", maxMs: 15000, mustNotContain: "I can't", category: "action" },
  { query: "export vendor list as Excel", maxMs: 20000, mustContain: "xlsx", category: "action" },
  { query: "search my email for Powers", maxMs: 20000, mustContain: "Powers", category: "action" },
  { query: "transactions", maxMs: 5000, maxLength: 2000, category: "rene", actor: "rene" },
  { query: "what needs my attention", maxMs: 15000, category: "rene", actor: "rene" },
  { query: "?", maxMs: 5000, mustNotContain: "error", category: "edge" },
  { query: "ok", maxMs: 5000, mustNotContain: "error", category: "edge" },
  { query: "how are things going", maxMs: 15000, category: "edge" },
  { query: "what is the weather in Spokane", maxMs: 15000, category: "edge" },
];

function loadEnvFile() {
  const text = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return env;
}

function average(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

const env = loadEnvFile();
const baseUrl = process.argv[2] || "https://www.usagummies.com";
const authHeader = env.CRON_SECRET ? { Authorization: `Bearer ${env.CRON_SECRET}` } : {};
const results = [];

for (const warmupQuery of ["help", "rev", "cash", "pnl"]) {
  await fetch(`${baseUrl}/api/ops/abra/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
    },
    body: JSON.stringify({
      message: warmupQuery,
      channel: "slack",
      slack_channel_id: "C0ALS6W7VB4",
      actor_label: "ben",
    }),
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
}

for (const test of STABLE_QUERIES) {
  const actor = test.actor || "ben";
  const startedAt = Date.now();
  let status = 500;
  let reply = "";
  let promptVersion = null;
  let error = null;
  try {
    const res = await fetch(`${baseUrl}/api/ops/abra/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        message: test.query,
        channel: "slack",
        slack_channel_id: actor === "rene" ? "C0AKG9FSC2J" : "C0ALS6W7VB4",
        actor_label: actor,
      }),
      signal: AbortSignal.timeout(Math.max(test.maxMs + 5000, 12000)),
    });
    status = res.status;
    const payload = await res.json().catch(() => ({}));
    reply = typeof payload.reply === "string" ? payload.reply : "";
    promptVersion = typeof payload.prompt_version === "string" ? payload.prompt_version : null;
    if (!res.ok) {
      error = typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ms = Date.now() - startedAt;
  const mustContainPassed = test.mustContain
    ? reply.toLowerCase().includes(test.mustContain.toLowerCase())
    : true;
  const mustNotContainPassed = test.mustNotContain
    ? !reply.toLowerCase().includes(test.mustNotContain.toLowerCase())
    : true;
  const maxLengthPassed = test.maxLength ? reply.length <= test.maxLength : true;
  const passed =
    !error &&
    reply.trim().length > 0 &&
    status >= 200 &&
    status < 300 &&
    ms <= test.maxMs &&
    mustContainPassed &&
    mustNotContainPassed &&
    maxLengthPassed;

  results.push({
    query: test.query,
    category: test.category,
    actor,
    ms,
    passed,
    status,
    promptVersion,
    error,
    replyPreview: reply.slice(0, 240),
  });
  console.log(
    `${passed ? "PASS" : "FAIL"} ${test.query} | category=${test.category} actor=${actor} ms=${ms} status=${status} mustContain=${mustContainPassed} mustNotContain=${mustNotContainPassed} maxLength=${maxLengthPassed}`,
  );
  if (!passed) {
    console.log(`  reply=${reply.slice(0, 400)}`);
    if (error) console.log(`  error=${error}`);
  }
}

const avgByCategory = Object.fromEntries(
  [...new Set(results.map((row) => row.category))].map((category) => [
    category,
    average(results.filter((row) => row.category === category).map((row) => row.ms)),
  ]),
);

console.log("\nSUMMARY");
console.log(
  JSON.stringify(
    {
      baseUrl,
      promptVersion: results.find((row) => row.promptVersion)?.promptVersion || null,
      passed: results.filter((row) => row.passed).length,
      total: results.length,
      avgByCategory,
    },
    null,
    2,
  ),
);
