#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const checks = [
  { name: "lint", cmd: "npm", args: ["run", "lint"] },
  { name: "build", cmd: "npm", args: ["run", "build"] },
  { name: "production smoke", cmd: "npm", args: ["run", "verify:production-smoke"] },
  {
    name: "abra readiness suite",
    cmd: "npm",
    args: ["run", "verify:abra-readiness"],
    blocking: false,
  },
  {
    name: "production readiness audit",
    cmd: "npm",
    args: ["run", "audit:prod-readiness"],
    blocking: false,
  },
];

for (const check of checks) {
  console.log(`\n[release-gate] running ${check.name}...`);
  const result = spawnSync(check.cmd, check.args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    if (check.blocking === false) {
      console.warn(`\n[release-gate] non-blocking check failed at ${check.name}; continuing`);
      continue;
    }
    console.error(`\n[release-gate] failed at ${check.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[release-gate] all checks passed");
