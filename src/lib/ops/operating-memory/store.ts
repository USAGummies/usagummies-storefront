/**
 * Storage adapters for operating-memory entries.
 *
 * Pattern mirrors `src/lib/ops/control-plane/stores/` — an interface
 * that's runtime-agnostic, an in-memory implementation for tests +
 * local dev, and a KV (Upstash Redis) implementation for cloud.
 *
 * The factory in this file picks the backend by env var (VERCEL=1 →
 * KV, otherwise in-memory). Tests can swap a fixture via
 * `__setOperatingMemoryStoreForTest()`.
 *
 * Dedupe contract: `put()` is idempotent on `entry.fingerprint`. A
 * second `put()` with a fingerprint that already exists is a no-op
 * that returns `"duplicate"`. The store, NOT the saver, is the
 * source of truth for dedupe — tests must drive dedupe through the
 * store interface to lock the contract.
 */

import type { OperatingMemoryEntry } from "./types";

export interface OperatingMemoryStore {
  /**
   * Persist an entry IF its fingerprint is unseen. Returns `"new"` if
   * stored, `"duplicate"` if a record with the same fingerprint already
   * existed.
   *
   * Implementations MUST guarantee that a same-fingerprint second call
   * leaves the existing record unchanged.
   */
  put(entry: OperatingMemoryEntry): Promise<"new" | "duplicate">;

  /** Look up by fingerprint. Returns null if unseen. */
  getByFingerprint(fingerprint: string): Promise<OperatingMemoryEntry | null>;

  /** Newest-first list, capped at `limit`. For drift-audit + dashboards. */
  recent(limit: number): Promise<OperatingMemoryEntry[]>;

  /** Filter by kind, newest-first. */
  byKind(kind: OperatingMemoryEntry["kind"], limit: number): Promise<OperatingMemoryEntry[]>;
}

// ============================================================
// In-memory implementation — tests + local dev
// ============================================================

export class InMemoryOperatingMemoryStore implements OperatingMemoryStore {
  private readonly byFingerprint = new Map<string, OperatingMemoryEntry>();
  private readonly insertionOrder: string[] = [];

  async put(entry: OperatingMemoryEntry): Promise<"new" | "duplicate"> {
    if (this.byFingerprint.has(entry.fingerprint)) return "duplicate";
    this.byFingerprint.set(entry.fingerprint, structuredClone(entry));
    this.insertionOrder.push(entry.fingerprint);
    return "new";
  }

  async getByFingerprint(fingerprint: string): Promise<OperatingMemoryEntry | null> {
    const found = this.byFingerprint.get(fingerprint);
    return found ? structuredClone(found) : null;
  }

  async recent(limit: number): Promise<OperatingMemoryEntry[]> {
    const out: OperatingMemoryEntry[] = [];
    for (let i = this.insertionOrder.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.byFingerprint.get(this.insertionOrder[i]);
      if (e) out.push(structuredClone(e));
    }
    return out;
  }

  async byKind(
    kind: OperatingMemoryEntry["kind"],
    limit: number,
  ): Promise<OperatingMemoryEntry[]> {
    const out: OperatingMemoryEntry[] = [];
    for (let i = this.insertionOrder.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.byFingerprint.get(this.insertionOrder[i]);
      if (e && e.kind === kind) out.push(structuredClone(e));
    }
    return out;
  }

  // test helper — not part of the OperatingMemoryStore interface
  _clear(): void {
    this.byFingerprint.clear();
    this.insertionOrder.length = 0;
  }

  get _size(): number {
    return this.byFingerprint.size;
  }
}

// ============================================================
// KV (Upstash Redis) implementation — cloud runtime
// ============================================================

interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string, opts?: { nx?: boolean }): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

const NS = "3.0:opmem";
const RECENT_CAP = 1000;

const K = {
  entry: (fp: string) => `${NS}:entry:${fp}`,
  recent: `${NS}:recent`,
  byKind: (kind: string) => `${NS}:by-kind:${kind}`,
} as const;

let kvClientRef: RedisLike | null = null;

function kvClient(): RedisLike {
  if (kvClientRef) return kvClientRef;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Operating-memory KV not configured. Set KV_REST_API_URL + KV_REST_API_TOKEN " +
        "(or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). For tests + local dev, " +
        "use InMemoryOperatingMemoryStore.",
    );
  }
  // Lazy require to keep the module importable in environments where
  // @upstash/redis is not yet installed (e.g. early test runs).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as { Redis: new (cfg: { url: string; token: string }) => RedisLike };
  kvClientRef = new Redis({ url, token });
  return kvClientRef;
}

export function __resetKvOpMemClient(): void {
  kvClientRef = null;
}

export function __setKvOpMemClientForTest(c: RedisLike): void {
  kvClientRef = c;
}

export class KvOperatingMemoryStore implements OperatingMemoryStore {
  async put(entry: OperatingMemoryEntry): Promise<"new" | "duplicate"> {
    const r = kvClient();
    const setRes = await r.set(K.entry(entry.fingerprint), JSON.stringify(entry), { nx: true });
    if (setRes === null || setRes === undefined) return "duplicate";
    // SET returned "OK" (or a truthy value) → it's a new record
    if (typeof setRes === "string" && setRes.toUpperCase() !== "OK") {
      return "duplicate";
    }
    await r.lpush(K.recent, entry.fingerprint);
    await r.ltrim(K.recent, 0, RECENT_CAP - 1);
    await r.lpush(K.byKind(entry.kind), entry.fingerprint);
    await r.ltrim(K.byKind(entry.kind), 0, RECENT_CAP - 1);
    return "new";
  }

  async getByFingerprint(fingerprint: string): Promise<OperatingMemoryEntry | null> {
    const r = kvClient();
    const raw = await r.get<string>(K.entry(fingerprint));
    if (!raw) return null;
    try {
      // Upstash returns parsed JSON for object-shaped values, raw string otherwise.
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as OperatingMemoryEntry) : (raw as OperatingMemoryEntry);
      return parsed;
    } catch {
      return null;
    }
  }

  async recent(limit: number): Promise<OperatingMemoryEntry[]> {
    const r = kvClient();
    const fps = await r.lrange(K.recent, 0, Math.max(0, limit - 1));
    return this.hydrate(fps);
  }

  async byKind(
    kind: OperatingMemoryEntry["kind"],
    limit: number,
  ): Promise<OperatingMemoryEntry[]> {
    const r = kvClient();
    const fps = await r.lrange(K.byKind(kind), 0, Math.max(0, limit - 1));
    return this.hydrate(fps);
  }

  private async hydrate(fps: string[]): Promise<OperatingMemoryEntry[]> {
    const out: OperatingMemoryEntry[] = [];
    for (const fp of fps) {
      const e = await this.getByFingerprint(fp);
      if (e) out.push(e);
    }
    return out;
  }
}

// ============================================================
// Factory + test injection
// ============================================================

let storeSingleton: OperatingMemoryStore | null = null;

function isCloud(): boolean {
  return process.env.VERCEL === "1";
}

export function operatingMemoryStore(): OperatingMemoryStore {
  if (storeSingleton) return storeSingleton;
  storeSingleton = isCloud() ? new KvOperatingMemoryStore() : new InMemoryOperatingMemoryStore();
  return storeSingleton;
}

export function __setOperatingMemoryStoreForTest(s: OperatingMemoryStore): void {
  storeSingleton = s;
}

export function __resetOperatingMemoryStore(): void {
  storeSingleton = null;
}
