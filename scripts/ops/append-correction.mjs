#!/usr/bin/env node
/**
 * Append a human correction to the control-plane CorrectionStore.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/ops/append-correction.mjs \
 *     --agentId viktor \
 *     --division sales \
 *     --correctedBy Ben \
 *     [--field deal_stage] \
 *     [--wrongValue "Sample Requested"] \
 *     [--correctValue "Sample Shipped"] \
 *     [--note "Tracking 9405... was in thread but missed"]
 *
 * Canonical spec: /contracts/governance.md §6.
 */

import { callJson, parseArgs, fail, printResult } from "./control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.agentId || !args.division || !args.correctedBy) {
  fail(
    "Missing required args. See header comment for usage. Required: --agentId --division --correctedBy",
    2,
  );
}

const tryParse = (raw) => {
  if (raw === undefined || raw === true) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const result = await callJson("/api/ops/control-plane/corrections", {
  method: "POST",
  body: JSON.stringify({
    agentId: args.agentId,
    division: args.division,
    correctedBy: args.correctedBy,
    field: args.field,
    wrongValue: tryParse(args.wrongValue),
    correctValue: tryParse(args.correctValue),
    note: args.note,
  }),
});
printResult(result, `appended correction for agent=${args.agentId}`);
