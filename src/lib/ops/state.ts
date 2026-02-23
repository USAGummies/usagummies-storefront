/**
 * Dual-mode state abstraction — reads/writes from Vercel KV on cloud,
 * local JSON files on laptop. Every API route uses this instead of raw fs.
 *
 * Usage:
 *   import { readState, writeState, isCloud } from "@/lib/ops/state";
 *   const ledger = await readState("run-ledger", []);
 *   await writeState("reply-queue", updatedQueue);
 */

import fs from "node:fs";
import path from "node:path";
import type { StateKey } from "./state-keys";
import { keyToFilePath, kvKey } from "./state-keys";

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export function isCloud(): boolean {
  return process.env.VERCEL === "1";
}

// ---------------------------------------------------------------------------
// Lazy KV client (only loaded on Vercel)
// ---------------------------------------------------------------------------

type KVClient = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<string | null>;
};

let _kv: KVClient | null = null;

async function getKV(): Promise<KVClient> {
  if (!_kv) {
    const mod = await import("@vercel/kv");
    _kv = mod.kv as KVClient;
  }
  return _kv;
}

// ---------------------------------------------------------------------------
// Core read/write — JSON state
// ---------------------------------------------------------------------------

/**
 * Read a JSON state value by key.
 * Cloud: Vercel KV  |  Local: filesystem JSON file
 */
export async function readState<T>(key: StateKey, fallback: T): Promise<T> {
  if (isCloud()) {
    try {
      const kv = await getKV();
      const value = await kv.get<T>(kvKey(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Local filesystem
  const filePath = keyToFilePath(key);
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON state value by key.
 * Cloud: Vercel KV  |  Local: filesystem JSON file
 */
export async function writeState<T>(key: StateKey, value: T): Promise<void> {
  if (isCloud()) {
    try {
      const kv = await getKV();
      await kv.set(kvKey(key), value);
    } catch (err) {
      console.error(`[state] KV write failed for ${key}:`, err);
    }
    return;
  }

  // Local filesystem
  const filePath = keyToFilePath(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Text state — for log files, PID files, etc.
// ---------------------------------------------------------------------------

/**
 * Read a text state value (non-JSON). Returns raw string.
 * Cloud: KV (stored as string)  |  Local: raw file read
 */
export async function readStateText(key: StateKey, fallback = ""): Promise<string> {
  if (isCloud()) {
    try {
      const kv = await getKV();
      const value = await kv.get<string>(kvKey(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  const filePath = keyToFilePath(key);
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

/**
 * Read the last N lines of a text state value.
 * Cloud: stored as pre-tailed array  |  Local: tail from file
 */
export async function readStateTail(key: StateKey, lines = 80): Promise<string[]> {
  if (isCloud()) {
    try {
      const kv = await getKV();
      // On cloud, log tails are stored as arrays of strings
      const value = await kv.get<string[] | string>(kvKey(key));
      if (Array.isArray(value)) return value.slice(-lines);
      if (typeof value === "string") {
        return value.split("\n").filter(Boolean).slice(-lines);
      }
      return [];
    } catch {
      return [];
    }
  }

  const filePath = keyToFilePath(key);
  try {
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, "utf8");
    return text.split("\n").filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers for common patterns
// ---------------------------------------------------------------------------

/**
 * Read a JSON array state value, guaranteed to return an array.
 */
export async function readStateArray<T = unknown>(key: StateKey): Promise<T[]> {
  const value = await readState(key, [] as T[]);
  return Array.isArray(value) ? value : [];
}

/**
 * Read a JSON object state value, guaranteed to return an object.
 */
export async function readStateObject(key: StateKey): Promise<Record<string, unknown>> {
  const value = await readState(key, {} as Record<string, unknown>);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Append items to an array state, keeping the last maxItems entries.
 */
export async function appendStateArray<T>(
  key: StateKey,
  newItems: T[],
  maxItems = 5000,
): Promise<void> {
  const existing = await readStateArray<T>(key);
  existing.push(...newItems);
  await writeState(key, existing.slice(-maxItems));
}
