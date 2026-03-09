#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");

const CONTRACTS = [
  { route: "/api/ops/alerts", file: "src/app/api/ops/alerts/route.ts", methods: ["GET", "PATCH"] },
  { route: "/api/ops/amazon-profitability", file: "src/app/api/ops/amazon-profitability/route.ts", methods: ["GET"] },
  { route: "/api/ops/approvals", file: "src/app/api/ops/approvals/route.ts", methods: ["GET", "POST"] },
  { route: "/api/ops/audit", file: "src/app/api/ops/audit/route.ts", methods: ["GET"] },
  { route: "/api/ops/balances", file: "src/app/api/ops/balances/route.ts", methods: ["GET", "POST"] },
  { route: "/api/ops/channels", file: "src/app/api/ops/channels/route.ts", methods: ["GET"] },
  { route: "/api/ops/dashboard", file: "src/app/api/ops/dashboard/route.ts", methods: ["GET"] },
  { route: "/api/ops/deal-emails", file: "src/app/api/ops/deal-emails/route.ts", methods: ["GET"] },
  { route: "/api/ops/engine/[engine]/[agent]", file: "src/app/api/ops/engine/[engine]/[agent]/route.ts", methods: ["POST"] },
  { route: "/api/ops/finance", file: "src/app/api/ops/finance/route.ts", methods: ["GET"] },
  { route: "/api/ops/forecast", file: "src/app/api/ops/forecast/route.ts", methods: ["GET"] },
  { route: "/api/ops/inbox", file: "src/app/api/ops/inbox/route.ts", methods: ["GET"] },
  { route: "/api/ops/inventory", file: "src/app/api/ops/inventory/route.ts", methods: ["GET", "POST"] },
  { route: "/api/ops/marketing", file: "src/app/api/ops/marketing/route.ts", methods: ["GET"] },
  { route: "/api/ops/notify", file: "src/app/api/ops/notify/route.ts", methods: ["POST"] },
  { route: "/api/ops/pipeline", file: "src/app/api/ops/pipeline/route.ts", methods: ["GET"] },
  { route: "/api/ops/pnl", file: "src/app/api/ops/pnl/route.ts", methods: ["GET"] },
  { route: "/api/ops/scheduler/master", file: "src/app/api/ops/scheduler/master/route.ts", methods: ["GET", "POST"] },
  { route: "/api/ops/settings", file: "src/app/api/ops/settings/route.ts", methods: ["GET", "PATCH"] },
  { route: "/api/ops/status", file: "src/app/api/ops/status/route.ts", methods: ["GET"] },
  { route: "/api/ops/supply-chain", file: "src/app/api/ops/supply-chain/route.ts", methods: ["GET"] },
  { route: "/api/ops/transactions", file: "src/app/api/ops/transactions/route.ts", methods: ["GET"] },
  { route: "/api/ops/wholesale/order", file: "src/app/api/ops/wholesale/order/route.ts", methods: ["POST"] },
  { route: "/api/ops/wholesale/products", file: "src/app/api/ops/wholesale/products/route.ts", methods: ["GET"] },
];

function readFile(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Missing file: ${relPath}`);
  }
  return fs.readFileSync(absPath, "utf8");
}

function parseMethods(fileContent) {
  const methods = new Set();
  const regex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  let match;
  while ((match = regex.exec(fileContent)) !== null) {
    methods.add(match[1]);
  }
  return [...methods].sort();
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Production Readiness Audit");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Route surface: ${report.routeSurface}`);
  lines.push(`- Contracts passed: ${report.summary.passedContracts}/${report.routeSurface}`);
  lines.push(`- Contracts failed: ${report.summary.failedContracts}`);
  lines.push(`- Critical checks failed: ${report.summary.failedChecks}`);
  lines.push("");
  lines.push("## Critical Checks");
  for (const check of report.checks) {
    lines.push(`- ${check.name}: ${check.ok ? "PASS" : "FAIL"}${check.details ? ` (${check.details})` : ""}`);
  }
  lines.push("");
  lines.push("## Contract Results");
  for (const contract of report.contracts) {
    lines.push(
      `- ${contract.route}: ${contract.ok ? "PASS" : "FAIL"} (expected ${contract.expected.join(",")}; actual ${contract.actual.join(",") || "none"})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function run() {
  const contracts = [];
  let passedContracts = 0;

  for (const contract of CONTRACTS) {
    const content = readFile(contract.file);
    const actual = parseMethods(content);
    const missing = contract.methods.filter((method) => !actual.includes(method));
    const ok = missing.length === 0;
    if (ok) passedContracts += 1;

    contracts.push({
      route: contract.route,
      file: contract.file,
      expected: contract.methods,
      actual,
      missing,
      ok,
    });
  }

  const middlewareContent = readFile("src/middleware.ts");
  const envCheckContent = readFile("src/lib/ops/env-check.ts");
  const alertsContent = readFile("src/app/api/ops/alerts/route.ts");

  const checks = [
    {
      name: "Middleware protects /api/ops",
      ok: middlewareContent.includes('"/api/ops/:path*"'),
      details: "matcher contains /api/ops/:path*",
    },
    {
      name: "Self-authenticated routes explicitly scoped",
      ok:
        middlewareContent.includes('"/api/ops/scheduler/master"') &&
        middlewareContent.includes('"/api/ops/engine/"') &&
        middlewareContent.includes('"/api/ops/notify"'),
      details: "scheduler/engine/notify allowlist present",
    },
    {
      name: "Integration inventory has >=24 connectors",
      ok: (envCheckContent.match(/key:\s*"/g) || []).length >= 24,
      details: `found ${(envCheckContent.match(/key:\s*"/g) || []).length} connector definitions`,
    },
    {
      name: "Stale credential alarms wired into alerts",
      ok:
        alertsContent.includes("source: \"integration\"") &&
        alertsContent.includes("stale_credentials"),
      details: "integration alerts emitted for stale/not_configured states",
    },
  ];

  const failedContracts = contracts.length - passedContracts;
  const failedChecks = checks.filter((check) => !check.ok).length;
  const hasFailure = failedContracts > 0 || failedChecks > 0;

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    routeSurface: CONTRACTS.length,
    contracts,
    checks,
    summary: {
      passedContracts,
      failedContracts,
      failedChecks,
      ok: !hasFailure,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[.:]/g, "-");
  const baseName = `production-readiness-audit-${stamp}`;
  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${baseName}.md`);
  const sigPath = path.join(OUTPUT_DIR, `${baseName}.sha256`);

  const jsonPayload = JSON.stringify(report, null, 2);
  const digest = sha256(jsonPayload);
  fs.writeFileSync(jsonPath, jsonPayload, "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");
  fs.writeFileSync(sigPath, `${digest}  ${baseName}.json\n`, "utf8");

  console.log(`[prod-readiness] route surface: ${CONTRACTS.length}`);
  console.log(`[prod-readiness] contracts: ${passedContracts}/${CONTRACTS.length} pass`);
  console.log(`[prod-readiness] critical checks: ${checks.length - failedChecks}/${checks.length} pass`);
  console.log(`[prod-readiness] artifacts:`);
  console.log(`  - ${path.relative(ROOT, jsonPath)}`);
  console.log(`  - ${path.relative(ROOT, mdPath)}`);
  console.log(`  - ${path.relative(ROOT, sigPath)}`);

  if (hasFailure) {
    process.exit(1);
  }
}

try {
  run();
} catch (error) {
  console.error(`[prod-readiness] failed: ${String(error?.message || error)}`);
  process.exit(1);
}
