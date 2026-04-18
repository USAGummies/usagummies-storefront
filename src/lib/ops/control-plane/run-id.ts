/**
 * Run identity — one run_id per agent invocation, shared across every
 * side-effect that invocation produces. Blueprint §6.1.
 */

import { randomUUID } from "node:crypto";

import type { RunContext, DivisionId } from "./types";

export function newRunId(): string {
  return randomUUID();
}

export function newRunContext(params: {
  agentId: string;
  division: DivisionId;
  source: RunContext["source"];
  trigger?: string;
}): RunContext {
  return {
    runId: newRunId(),
    agentId: params.agentId,
    division: params.division,
    startedAt: new Date().toISOString(),
    source: params.source,
    trigger: params.trigger,
  };
}
