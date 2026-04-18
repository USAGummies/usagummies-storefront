#!/usr/bin/env node
/**
 * Unpause an auto-paused agent.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/ops/unpause-agent.mjs \
 *     --agentId viktor \
 *     --reason "Reviewed drift-audit scorecard sc-xxx; violations were legitimate fail-safe triggers, prompts tightened" \
 *     [--actor Ben|Rene|Drew]
 *
 * The unpause event is recorded as a human-authored audit entry so the
 * unpause decision is attributable. Canonical spec: /contracts/governance.md §5 + §6.
 */

import { callJson, parseArgs, fail, printResult } from "./control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.agentId || !args.reason) {
  fail(
    "Missing required args. Required: --agentId --reason",
    2,
  );
}

const result = await callJson("/api/ops/control-plane/unpause", {
  method: "POST",
  body: JSON.stringify({
    agentId: args.agentId,
    reason: args.reason,
    actor: args.actor ?? "Ben",
  }),
});
printResult(result, `unpause ${args.agentId}`);
