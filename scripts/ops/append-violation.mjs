#!/usr/bin/env node
/**
 * Append a policy violation to the control-plane ViolationStore.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/ops/append-violation.mjs \
 *     --agentId viktor \
 *     --division sales \
 *     --kind missing_citation \
 *     --detail "Weekly digest claimed pipeline $14K without a HubSpot retrievedAt" \
 *     [--detectedBy drift-audit|self-check|human-correction] \
 *     [--remediation "Updated Viktor boot ritual to include HubSpot freshness check"] \
 *     [--runId <uuid>]
 *
 * Kinds:
 *   fabricated_data unapproved_write prohibited_action stale_data
 *   missing_citation duplicate_output wrong_channel
 */

import { callJson, parseArgs, fail, printResult } from "./control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.agentId || !args.division || !args.kind || !args.detail) {
  fail(
    "Missing required args. See header comment for usage. Required: --agentId --division --kind --detail",
    2,
  );
}

const result = await callJson("/api/ops/control-plane/violations", {
  method: "POST",
  body: JSON.stringify({
    agentId: args.agentId,
    division: args.division,
    kind: args.kind,
    detail: args.detail,
    detectedBy: args.detectedBy ?? "human-correction",
    remediation: args.remediation,
    runId: args.runId,
  }),
});
printResult(result, `appended violation for agent=${args.agentId}`);
