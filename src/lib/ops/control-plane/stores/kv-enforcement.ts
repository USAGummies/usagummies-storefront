/**
 * KV-backed enforcement stores. Same backend as the other KV stores
 * (@upstash/redis under the `3.0:` namespace).
 *
 * Keys:
 *   3.0:paused:<agentId>           JSON blob of PausedAgentRecord
 *   3.0:paused:index               SET of currently paused agentIds
 *   3.0:paused:log                 LIST newest-first of pause+unpause events (audit-friendly)
 *
 *   3.0:violation:<id>             JSON blob of PolicyViolation
 *   3.0:violations:byTime          ZSET scored by detectedAt epoch ms
 *   3.0:violations:everRecorded    STRING "1" once any violation exists
 *
 *   3.0:correction:<id>            JSON blob of CorrectionEvent
 *   3.0:corrections:byTime         ZSET scored by `at` epoch ms
 *   3.0:corrections:everRecorded   STRING "1" once any correction exists
 */

import { Redis } from "@upstash/redis";

import type {
  CorrectionEvent,
  CorrectionStore,
  PauseSink,
  PausedAgentRecord,
  ViolationStore,
} from "../enforcement";
import type { PolicyViolation } from "../types";

// Local structural interface — same as kv-stores.ts RedisLike. Kept
// local to avoid cross-module coupling on a minimal client surface.
export interface EnforcementRedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
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
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  multi(): any;
}

// ---- Lazy client -------------------------------------------------------

let clientRef: EnforcementRedisLike | null = null;

function client(): EnforcementRedisLike {
  if (clientRef) return clientRef;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "KV not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_* equivalents).",
    );
  }
  clientRef = new Redis({ url, token }) as unknown as EnforcementRedisLike;
  return clientRef;
}

export function __setKvEnforcementClientForTest(c: EnforcementRedisLike): void {
  clientRef = c;
}
export function __resetKvEnforcementClient(): void {
  clientRef = null;
}

// ---- Keyspace ----------------------------------------------------------

const NS = "3.0";
const K = {
  pausedRecord: (id: string) => `${NS}:paused:${id}`,
  pausedIndex: `${NS}:paused:index`,
  pausedLog: `${NS}:paused:log`,
  violationRecord: (id: string) => `${NS}:violation:${id}`,
  violationsByTime: `${NS}:violations:byTime`,
  violationsEver: `${NS}:violations:everRecorded`,
  correctionRecord: (id: string) => `${NS}:correction:${id}`,
  correctionsByTime: `${NS}:corrections:byTime`,
  correctionsEver: `${NS}:corrections:everRecorded`,
} as const;

function parse<T>(raw: string | T | null): T | null {
  if (raw == null) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as T) : raw;
}

// ---- KvPauseSink -------------------------------------------------------

export class KvPauseSink implements PauseSink {
  async pauseAgent(record: PausedAgentRecord): Promise<void> {
    const r = client();
    const tx = r.multi();
    tx.set(K.pausedRecord(record.agentId), JSON.stringify(record));
    tx.sadd(K.pausedIndex, record.agentId);
    tx.lpush(
      K.pausedLog,
      JSON.stringify({ type: "pause", ...record }),
    );
    tx.ltrim(K.pausedLog, 0, 999); // keep last 1000 events
    await tx.exec();
  }

  async isPaused(agentId: string): Promise<boolean> {
    return (await client().exists(K.pausedRecord(agentId))) > 0;
  }

  async listPaused(): Promise<PausedAgentRecord[]> {
    const r = client();
    const ids = await r.smembers(K.pausedIndex);
    if (!ids || ids.length === 0) return [];
    const raws = await r.mget<string | PausedAgentRecord>(
      ...ids.map(K.pausedRecord),
    );
    const records = raws
      .map((raw) => parse<PausedAgentRecord>(raw))
      .filter((x): x is PausedAgentRecord => x !== null);
    // Removal race: index member may point at a deleted record. Trust
    // whichever side has state and skip stragglers.
    return records;
  }

  async unpauseAgent(agentId: string, reason: string): Promise<void> {
    const r = client();
    const tx = r.multi();
    tx.del(K.pausedRecord(agentId));
    tx.srem(K.pausedIndex, agentId);
    tx.lpush(
      K.pausedLog,
      JSON.stringify({ type: "unpause", agentId, reason, at: new Date().toISOString() }),
    );
    tx.ltrim(K.pausedLog, 0, 999);
    await tx.exec();
  }
}

// ---- KvViolationStore --------------------------------------------------

export class KvViolationStore implements ViolationStore {
  async append(v: PolicyViolation): Promise<void> {
    const r = client();
    const score = new Date(v.detectedAt).getTime();
    const tx = r.multi();
    tx.set(K.violationRecord(v.id), JSON.stringify(v));
    tx.zadd(K.violationsByTime, { score, member: v.id });
    tx.set(K.violationsEver, "1");
    await tx.exec();
  }

  async listInWindow(sinceISO: string, untilISO: string): Promise<PolicyViolation[]> {
    const r = client();
    const min = new Date(sinceISO).getTime();
    const max = new Date(untilISO).getTime();
    const ids = await r.zrange<string>(K.violationsByTime, min, max, { byScore: true });
    if (!ids || ids.length === 0) return [];
    const raws = await r.mget<string | PolicyViolation>(...ids.map(K.violationRecord));
    return raws
      .map((raw) => parse<PolicyViolation>(raw))
      .filter((x): x is PolicyViolation => x !== null)
      .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  }

  async hasAnyEverRecorded(): Promise<boolean> {
    return (await client().exists(K.violationsEver)) > 0;
  }
}

// ---- KvCorrectionStore -------------------------------------------------

export class KvCorrectionStore implements CorrectionStore {
  async append(c: CorrectionEvent): Promise<void> {
    const r = client();
    const score = new Date(c.at).getTime();
    const tx = r.multi();
    tx.set(K.correctionRecord(c.id), JSON.stringify(c));
    tx.zadd(K.correctionsByTime, { score, member: c.id });
    tx.set(K.correctionsEver, "1");
    await tx.exec();
  }

  async countInWindow(sinceISO: string, untilISO: string): Promise<number> {
    const min = new Date(sinceISO).getTime();
    const max = new Date(untilISO).getTime();
    return client().zcount(K.correctionsByTime, min, max);
  }

  async hasAnyEverRecorded(): Promise<boolean> {
    return (await client().exists(K.correctionsEver)) > 0;
  }
}
