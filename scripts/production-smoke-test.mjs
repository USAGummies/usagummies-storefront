#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://www.usagummies.com";

function parseEnvLocal(filePath) {
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = normalized.slice(0, eqIndex).trim();
    let value = normalized.slice(eqIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

function summarizeBody(bodyText) {
  if (!bodyText) return "(empty body)";
  return bodyText.length > 240 ? `${bodyText.slice(0, 240)}...` : bodyText;
}

async function run() {
  const baseUrlRaw = process.argv[2] || DEFAULT_BASE_URL;
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const envPath = path.resolve(process.cwd(), ".env.local");
  let env = {};

  if (fs.existsSync(envPath)) {
    env = parseEnvLocal(envPath);
  }

  const cronSecret = (process.env.CRON_SECRET || env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    console.error("CRON_SECRET is missing (env or .env.local)");
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    "Content-Type": "application/json",
  };

  const tests = [
    {
      name: "GET /api/ops/abra/health",
      method: "GET",
      path: "/api/ops/abra/health",
      validate: (status) => status === 200,
    },
    {
      name: "GET /api/ops/abra/integration-test",
      method: "GET",
      path: "/api/ops/abra/integration-test?mode=quick",
      validate: (status) => status === 200,
    },
    {
      name: "POST /api/ops/abra/chat",
      method: "POST",
      path: "/api/ops/abra/chat?mode=health",
      body: { message: "What does USA Gummies sell?" },
      validate: (status, json) =>
        status === 200 && !!json && typeof json.reply === "string" && json.reply.trim().length > 0,
    },
    {
      name: "GET /api/ops/abra/initiative?department=finance",
      method: "GET",
      path: "/api/ops/abra/initiative?department=finance",
      validate: (status) => status === 200,
    },
    {
      name: "GET /api/ops/abra/cost",
      method: "GET",
      path: "/api/ops/abra/cost",
      validate: (status) => status === 200,
    },
    {
      name: "GET /api/ops/abra/morning-brief",
      method: "GET",
      path: "/api/ops/abra/morning-brief?mode=quick",
      validate: (status) => status === 200,
    },
    {
      name: "GET /api/ops/abra/operational-signals",
      method: "GET",
      path: "/api/ops/abra/operational-signals",
      validate: (status) => status === 200,
    },
    {
      name: "GET /api/ops/abra/pipeline",
      method: "GET",
      path: "/api/ops/abra/pipeline",
      validate: (status) => status === 200,
    },
    {
      name: "POST /api/ops/abra/strategy",
      method: "POST",
      path: "/api/ops/abra/strategy?mode=quick",
      body: {
        objective:
          "Build an Amazon ads strategy with cross-department research, finance controls, and KPI stop-loss gates.",
      },
      validate: (status, json) =>
        status === 200 &&
        !!json &&
        typeof json === "object" &&
        typeof json.strategy?.summary === "string" &&
        json.strategy.summary.trim().length > 0,
    },
  ];

  let failures = 0;

  console.log(`Running production smoke test against ${baseUrl}`);
  for (const test of tests) {
    const started = Date.now();
    let status = 0;
    let bodyText = "";
    let json = null;

    try {
      const res = await fetch(`${baseUrl}${test.path}`, {
        method: test.method,
        headers,
        body: test.body ? JSON.stringify(test.body) : undefined,
      });
      status = res.status;
      bodyText = await res.text();
      if (bodyText) {
        try {
          json = JSON.parse(bodyText);
        } catch {
          json = null;
        }
      }
    } catch (error) {
      const elapsed = Date.now() - started;
      failures += 1;
      console.log(`FAIL ${test.name} (${elapsed}ms)`);
      console.log(
        `  request error: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const elapsed = Date.now() - started;
    const ok = test.validate(status, json, bodyText);
    if (ok) {
      console.log(`PASS ${test.name} (${elapsed}ms)`);
    } else {
      failures += 1;
      console.log(`FAIL ${test.name} (${elapsed}ms)`);
      console.log(`  status: ${status}`);
      console.log(`  body: ${summarizeBody(bodyText)}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(`Smoke test failed: ${failures}/${tests.length} checks failed.`);
    process.exit(1);
  }

  console.log(`Smoke test passed: ${tests.length}/${tests.length} checks passed.`);
}

void run();
