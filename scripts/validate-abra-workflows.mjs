#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const WORKFLOW_FILES = [
  "n8n-workflows/W01-gmail-ingestion.json",
  "n8n-workflows/W02-email-classifier.json",
  "n8n-workflows/W03-daily-briefing-generator.json",
  "n8n-workflows/W04-company-finance-snapshot.json",
  "n8n-workflows/W06-approval-processor.json",
  "n8n-workflows/W10-integration-health.json",
];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
];

let hasError = false;

function fail(message) {
  hasError = true;
  console.error(`FAIL: ${message}`);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

for (const relFile of WORKFLOW_FILES) {
  const file = path.resolve(relFile);
  if (!fs.existsSync(file)) {
    fail(`${relFile} missing`);
    continue;
  }

  const raw = fs.readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${relFile} invalid JSON: ${error.message}`);
    continue;
  }

  ok(`${relFile} valid JSON`);

  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    fail(`${relFile} has no nodes array`);
  }

  if (raw.includes("\"neverError\": true")) {
    fail(`${relFile} contains neverError=true`);
  } else {
    ok(`${relFile} has no neverError=true`);
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(raw)) {
      fail(`${relFile} matched secret pattern ${pattern}`);
      break;
    }
  }

  const envRefs = raw.match(/\$env\.[A-Z0-9_]+/g) || [];
  if (envRefs.length > 0) {
    ok(`${relFile} uses env refs (${Array.from(new Set(envRefs)).join(", ")})`);
  }
}

if (hasError) {
  process.exitCode = 1;
} else {
  console.log("All Abra workflow checks passed.");
}
