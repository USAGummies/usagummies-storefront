/**
 * Redis-backed stores for the 3.0 control plane.
 *
 * Persistence layer: @upstash/redis (same backend as @vercel/kv).
 *
 * Namespace: every key is prefixed `3.0:` to keep the 3.0 control plane
 * isolated from the legacy Abra key space under the same Upstash instance.
 *
 * Env vars required:
 *   KV_REST_API_URL      (or UPSTASH_REDIS_REST_URL)
 *   KV_REST_API_TOKEN    (or UPSTASH_REDIS_REST_TOKEN)
 *
 * Not configured → every method throws. Use InMemoryApprovalStore /
 * InMemoryAuditStore from memory-stores.ts for local dev and tests.
 *
 * Canonical blueprint: §15.4 T5a/T5b.
 */

import { Redis } from "@upstash/redis";

import type { ApprovalRequest, AuditLogEntry } from "../types";
import type { ApprovalStore } from "../approvals";
import type { AuditStore } from "../audit";

// ---- Keyspace ----------------------------------------------------------

const NS = "3.0";
const K = {
  approval: (id: string) => `${NS}:approval:${id}`,
  approvalsPending: `${NS}:approvals:pending`, // SET of approval ids currently status=pending
  approvalsByAgent: (agentId: string) => `${NS}:approvals:agent:${agentId}`, // LIST, most-recent first
  audit: (id: string) => `${NS}:audit:${id}`,
  auditRecent: `${NS}:audit:recent`, // LIST, LPUSH on append, LRANGE 0 N-1 for newest-first
  auditByRun: (runId: string) => `${NS}:audit:run:${runId}`, // LIST
  auditByAgent: (agentId: string) => `${NS}:audit:agent:${agentId}`, // ZSET, score = createdAt epoch ms
  auditByAction: (action: string) => `${NS}:audit:action:${action}`, // LIST, newest-first, cap 1000
} as const;

// ---- Client surface ---------------------------------------------------
//
// A small structural interface covering only the Redis methods this module
// uses. Declaring it locally — rather than deriving it from the Redis class
// with Pick<> — decouples us from the exact upstream method signatures (the
// @upstash/redis types bake in some variadic forms that make in-process
// fakes painful to type), while still letting a real `Redis` satisfy it
// structurally because TypeScript uses structural compatibility for
// interface members.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisPipeline = any;

export interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string): Promise<unknown>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrem(key: string, count: number, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  sadd(key: string, value: string): Promise<number>;
  srem(key: string, value: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, entry: { score: number; member: string }): Promise<number>;
  zrange<T = string>(
    key: string,
    min: number | string,
    max: number | string,
    opts?: { byScore?: boolean },
  ): Promise<T[]>;
  multi(): RedisPipeline;
}

let clientRef: RedisLike | null = null;

function client(): RedisLike {
  if (clientRef) return clientRef;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "KV not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_* equivalents). For tests and local dev, use InMemoryApprovalStore / InMemoryAuditStore from memory-stores.ts.",
    );
  }
  // Cast via `unknown` because Upstash's `Redis` exposes richer overloads
  // than our narrow RedisLike interface. Structurally compatible at runtime;
  // the cast just tells TypeScript we intentionally use the subset.
  clientRef = new Redis({ url, token }) as unknown as RedisLike;
  return clientRef;
}

// Reset for tests (the factory in index.ts picks memory stores in non-cloud anyway).
export function __resetKvClient(): void {
  clientRef = null;
}

/** Inject a test-double Redis client. Production code must not call this. */
export function __setKvClientForTest(c: RedisLike): void {
  clientRef = c;
}

// ---- Approval store ----------------------------------------------------

export class KvApprovalStore implements ApprovalStore {
  async put(request: ApprovalRequest): Promise<void> {
    const r = client();
    const tx = r.multi();
    tx.set(K.approval(request.id), JSON.stringify(request));
    if (request.status === "pending") {
      tx.sadd(K.approvalsPending, request.id);
    } else {
      tx.srem(K.approvalsPending, request.id);
    }
    // Track recent-by-agent. Remove any prior occurrence of this id first so
    // successive put() calls for the same approval id produce exactly one
    // list entry (dedup). LREM count=0 removes all occurrences. LPUSH then
    // sets this id at the head → list stays newest-first across updates.
    // LTRIM caps the list at 500 so it cannot grow unbounded.
    tx.lrem(K.approvalsByAgent(request.actorAgentId), 0, request.id);
    tx.lpush(K.approvalsByAgent(request.actorAgentId), request.id);
    tx.ltrim(K.approvalsByAgent(request.actorAgentId), 0, 499);
    await tx.exec();
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const raw = await client().get<string | ApprovalRequest>(K.approval(id));
    if (raw == null) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as ApprovalRequest) : raw;
  }

  async listPending(): Promise<ApprovalRequest[]> {
    const r = client();
    const ids = await r.smembers(K.approvalsPending);
    if (!ids || ids.length === 0) return [];
    const raws = await r.mget<string | ApprovalRequest>(...ids.map(K.approval));
    const requests = raws
      .map((raw) => {
        if (raw == null) return null;
        return typeof raw === "string" ? (JSON.parse(raw) as ApprovalRequest) : raw;
      })
      .filter((r): r is ApprovalRequest => r !== null && r.status === "pending");
    return requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listByAgent(agentId: string, limit = 100): Promise<ApprovalRequest[]> {
    const r = client();
    const ids = await r.lrange(K.approvalsByAgent(agentId), 0, Math.max(0, limit - 1));
    if (!ids || ids.length === 0) return [];
    const raws = await r.mget<string | ApprovalRequest>(...ids.map(K.approval));
    return raws
      .map((raw) => {
        if (raw == null) return null;
        return typeof raw === "string" ? (JSON.parse(raw) as ApprovalRequest) : raw;
      })
      .filter((r): r is ApprovalRequest => r !== null);
  }
}

// ---- Audit store -------------------------------------------------------

export class KvAuditStore implements AuditStore {
  async append(entry: AuditLogEntry): Promise<void> {
    const r = client();
    const score = new Date(entry.createdAt).getTime();
    const tx = r.multi();
    tx.set(K.audit(entry.id), JSON.stringify(entry));
    // Rolling recent index; cap at 10k so the list doesn't grow unbounded.
    tx.lpush(K.auditRecent, entry.id);
    tx.ltrim(K.auditRecent, 0, 9_999);
    tx.lpush(K.auditByRun(entry.runId), entry.id);
    tx.zadd(K.auditByAgent(entry.actorId), { score, member: entry.id });
    // Per-action secondary index — newest-first, cap 1000 per action.
    // Guarantees that the latest drift-audit.scorecard (weekly) is
    // findable regardless of how much high-volume activity lands after
    // it in auditRecent. 1000 weekly scorecards = ~19 years of history
    // per action; anything coarser-grained than weekly cap-hits
    // similarly far out.
    tx.lpush(K.auditByAction(entry.action), entry.id);
    tx.ltrim(K.auditByAction(entry.action), 0, 999);
    await tx.exec();
  }

  async recent(limit: number): Promise<AuditLogEntry[]> {
    const r = client();
    const ids = await r.lrange(K.auditRecent, 0, Math.max(0, limit - 1));
    return hydrateEntries(r, ids);
  }

  async byRun(runId: string): Promise<AuditLogEntry[]> {
    const r = client();
    const ids = await r.lrange(K.auditByRun(runId), 0, -1);
    const entries = await hydrateEntries(r, ids);
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async byAgent(agentId: string, sinceISO: string): Promise<AuditLogEntry[]> {
    const r = client();
    const min = new Date(sinceISO).getTime();
    const ids = await r.zrange<string>(K.auditByAgent(agentId), min, "+inf", {
      byScore: true,
    });
    if (!ids || ids.length === 0) return [];
    const entries = await hydrateEntries(r, ids);
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async byAction(action: string, limit: number): Promise<AuditLogEntry[]> {
    const r = client();
    const ids = await r.lrange(
      K.auditByAction(action),
      0,
      Math.max(0, limit - 1),
    );
    if (!ids || ids.length === 0) return [];
    return hydrateEntries(r, ids);
  }
}

async function hydrateEntries(r: RedisLike, ids: string[]): Promise<AuditLogEntry[]> {
  if (!ids || ids.length === 0) return [];
  const raws = await r.mget<string | AuditLogEntry | null>(...ids.map(K.audit));
  return raws
    .map((raw) => {
      if (raw == null) return null;
      return typeof raw === "string" ? (JSON.parse(raw) as AuditLogEntry) : raw;
    })
    .filter((e): e is AuditLogEntry => e !== null);
}
