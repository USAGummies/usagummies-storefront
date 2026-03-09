#!/usr/bin/env node
/**
 * Abra Brain Sync — scheduler wrapper.
 *
 * Called by engine-runner.ts with an agent key (ABRA1, ABRA2, etc.).
 * Dispatches to the appropriate sub-script.
 *
 * Usage:
 *   node scripts/abra-brain-sync.mjs run ABRA1
 *   node scripts/abra-brain-sync.mjs run ABRA2
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DISPATCH = {
  ABRA1: { script: "abra-email-ingest.mjs", args: ["--max", "50"] },
  ABRA2: { script: "abra-notion-sync.mjs", args: ["--db", "b2b"] },
  ABRA3: { script: "abra-notion-sync.mjs", args: ["--db", "distributors"] },
  ABRA4: { script: "abra-notion-sync.mjs", args: ["--db", "skus"] },
  ABRA5: { script: "abra-notion-sync.mjs", args: ["--db", "performance"] },
  ABRA6: { script: "abra-notion-sync.mjs", args: ["--db", "cash"] },
};

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0]; // "run"
  const agentKey = argv[1]; // "ABRA1", etc.

  if (command !== "run" || !agentKey) {
    console.log("Usage: node abra-brain-sync.mjs run <AGENT_KEY>");
    console.log("Keys:", Object.keys(DISPATCH).join(", "));
    process.exit(1);
  }

  const entry = DISPATCH[agentKey];
  if (!entry) {
    console.error(`Unknown agent key: ${agentKey}. Valid: ${Object.keys(DISPATCH).join(", ")}`);
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, entry.script);
  console.log(`[abra-brain-sync] Dispatching ${agentKey} → ${entry.script} ${entry.args.join(" ")}`);

  try {
    execFileSync("node", [scriptPath, ...entry.args], {
      stdio: "inherit",
      timeout: 260_000, // 260s < engine-runner's 270s
      env: process.env,
    });
  } catch (err) {
    console.error(`[abra-brain-sync] ${agentKey} failed:`, err.message);
    process.exit(1);
  }
}

main();
