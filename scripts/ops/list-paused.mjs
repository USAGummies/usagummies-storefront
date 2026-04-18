#!/usr/bin/env node
/**
 * List currently paused agents.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/ops/list-paused.mjs
 */
import { callJson, printResult } from "./control-plane.mjs";

const result = await callJson("/api/ops/control-plane/paused", { method: "GET" });
printResult(result, "paused agents");
