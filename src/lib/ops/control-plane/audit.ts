/**
 * Audit log — every autonomous write by every agent is recorded here.
 * Blueprint §6.1 + §15.5 (sign-off: "first audit log entries are visible").
 *
 * This module is storage-agnostic. The store adapter is implemented by
 * the persistence layer (Postgres or Vercel KV as a stopgap). The Slack
 * mirror (posting each entry to #ops-audit) is a separate concern and
 * plugs in via AuditSlackSurface.
 */

import { randomUUID } from "node:crypto";

import type { AuditLogEntry, DivisionId, RunContext } from "./types";

// ----- Storage adapter --------------------------------------------------

export interface AuditStore {
  append(entry: AuditLogEntry): Promise<void>;
  /** Recent entries newest-first, for the Sunday drift audit sampler. */
  recent(limit: number): Promise<AuditLogEntry[]>;
  /** Entries by run — for postmortems. */
  byRun(runId: string): Promise<AuditLogEntry[]>;
  /** Entries by agent over a time window — for graduation scoring. */
  byAgent(agentId: string, sinceISO: string): Promise<AuditLogEntry[]>;
}

export interface AuditSlackSurface {
  /** Post a compact one-line summary of the entry to #ops-audit. */
  mirror(entry: AuditLogEntry): Promise<void>;
}

// ----- Record helpers ---------------------------------------------------

export interface AuditFields {
  action: string; // "<system>.<verb>"
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  result: AuditLogEntry["result"];
  approvalId?: string;
  error?: AuditLogEntry["error"];
  sourceCitations?: AuditLogEntry["sourceCitations"];
  confidence?: number;
}

export function buildAuditEntry(
  run: RunContext,
  fields: AuditFields,
  now: Date = new Date(),
): AuditLogEntry {
  return {
    id: randomUUID(),
    runId: run.runId,
    division: run.division,
    actorType: "agent",
    actorId: run.agentId,
    action: fields.action,
    entityType: fields.entityType,
    entityId: fields.entityId,
    before: fields.before,
    after: fields.after,
    result: fields.result,
    approvalId: fields.approvalId,
    error: fields.error,
    sourceCitations: fields.sourceCitations ?? [],
    confidence: fields.confidence,
    createdAt: now.toISOString(),
  };
}

/**
 * Log a write and (best-effort) mirror to Slack. Storage is authoritative;
 * Slack is a mirror. A Slack failure is non-fatal.
 */
export async function logWrite(
  store: AuditStore,
  surface: AuditSlackSurface | null,
  run: RunContext,
  fields: AuditFields,
): Promise<AuditLogEntry> {
  const entry = buildAuditEntry(run, fields);
  await store.append(entry);
  if (surface) await surface.mirror(entry).catch(() => void 0);
  return entry;
}

/** Convenience: log a human-initiated write (e.g. manual Ben action recorded via UI). */
export async function logHumanWrite(
  store: AuditStore,
  surface: AuditSlackSurface | null,
  params: {
    division: DivisionId;
    actorId: string; // "Ben" | "Rene" | "Drew"
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    result?: AuditLogEntry["result"];
  },
): Promise<AuditLogEntry> {
  const entry: AuditLogEntry = {
    id: randomUUID(),
    runId: randomUUID(), // humans don't have a pre-existing runId; mint one
    division: params.division,
    actorType: "human",
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before,
    after: params.after,
    result: params.result ?? "ok",
    sourceCitations: [],
    createdAt: new Date().toISOString(),
  };
  await store.append(entry);
  if (surface) await surface.mirror(entry).catch(() => void 0);
  return entry;
}
