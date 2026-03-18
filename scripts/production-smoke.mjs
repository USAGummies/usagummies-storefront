#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function assertIncludes(relPath, needle, message) {
  const content = read(relPath);
  if (!content.includes(needle)) {
    throw new Error(`${message} (${relPath})`);
  }
}

function assertNotIncludes(relPath, needle, message) {
  const content = read(relPath);
  if (content.includes(needle)) {
    throw new Error(`${message} (${relPath})`);
  }
}

function run() {
  assertNotIncludes(
    "src/lib/auth/notion-user-adapter.ts",
    "admin@usagummies.com",
    "Hardcoded admin fallback credential still present"
  );
  assertIncludes(
    "src/lib/auth/notion-user-adapter.ts",
    "BREAK_GLASS_ADMIN_EMAIL",
    "Break-glass env credential flow missing"
  );

  assertIncludes(
    "src/middleware.ts",
    "/api/agentic/command-center",
    "Command center API path guard missing"
  );
  assertIncludes(
    "src/middleware.ts",
    "OPERATOR_ROLES",
    "Operator role gate missing"
  );

  assertIncludes(
    "src/app/api/agentic/reply-action/route.ts",
    "actionId",
    "Reply action immutable actionId is missing"
  );
  assertIncludes(
    "src/app/api/agentic/reply-action/route.ts",
    "authorizedByUserId",
    "Reply action actor metadata missing"
  );

  assertIncludes(
    "src/app/api/agentic/command-center/route.ts",
    "status: \"pass\" | \"fail\" | \"unknown\"",
    "System check tri-state model missing"
  );
  assertIncludes(
    "src/app/api/agentic/command-center/route.ts",
    "freshness",
    "Command center freshness payload missing"
  );

  assertIncludes(
    "src/app/robots.txt/route.ts",
    "new URL(siteUrl).host",
    "robots.txt host formatting fix missing"
  );

  console.log("production smoke checks passed");
}

try {
  run();
} catch (error) {
  console.error(`production smoke checks failed: ${String(error?.message || error)}`);
  process.exit(1);
}
