#!/usr/bin/env node
/**
 * Unpause an auto-paused agent. ADMIN-TIER route.
 *
 * Auth: uses CONTROL_PLANE_ADMIN_SECRET (not CRON_SECRET) via the
 * X-Admin-Authorization header. Per /contracts/governance.md §6.2 and
 * /src/lib/ops/control-plane/admin-auth.ts, unpause is the one action
 * that must not be reachable from scheduled callers who hold only the
 * cron secret.
 *
 * Usage:
 *   CONTROL_PLANE_ADMIN_SECRET=... node scripts/ops/unpause-agent.mjs \
 *     --agentId viktor \
 *     --reason "Reviewed drift-audit scorecard sc-xxx; prompts tightened"
 *
 * Note: any `--actor` flag is silently ignored by the server. The audit
 * entry always records actorId = "Ben" because admin-secret possession
 * is the authorization evidence — see /api/ops/control-plane/unpause.
 */

import { callAdminJson, parseArgs, fail, printResult } from "./control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.agentId || !args.reason) {
  fail(
    "Missing required args. Required: --agentId --reason",
    2,
  );
}

const result = await callAdminJson("/api/ops/control-plane/unpause", {
  method: "POST",
  body: JSON.stringify({
    agentId: args.agentId,
    reason: args.reason,
    // actor is ignored by the route; omitted here for clarity.
  }),
});
printResult(result, `unpause ${args.agentId}`);
