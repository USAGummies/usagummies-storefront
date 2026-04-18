/**
 * Store factory — picks the right backend for the runtime.
 *
 * Cloud (process.env.VERCEL === "1") → KV-backed (@upstash/redis).
 * Everything else → in-memory (tests + local dev fallback).
 *
 * Production code should always call `approvalStore()` and `auditStore()`
 * rather than instantiating the adapters directly, so the runtime wiring
 * can change without editing call sites.
 */

import type { ApprovalStore } from "../approvals";
import type { AuditStore } from "../audit";

import { InMemoryApprovalStore, InMemoryAuditStore } from "./memory-stores";
import { KvApprovalStore, KvAuditStore } from "./kv-stores";

// Process-level singletons so successive calls share state.
let approvalSingleton: ApprovalStore | null = null;
let auditSingleton: AuditStore | null = null;

function isCloud(): boolean {
  return process.env.VERCEL === "1";
}

export function approvalStore(): ApprovalStore {
  if (approvalSingleton) return approvalSingleton;
  approvalSingleton = isCloud() ? new KvApprovalStore() : new InMemoryApprovalStore();
  return approvalSingleton;
}

export function auditStore(): AuditStore {
  if (auditSingleton) return auditSingleton;
  auditSingleton = isCloud() ? new KvAuditStore() : new InMemoryAuditStore();
  return auditSingleton;
}

/** For tests — swap in a fixture. Production code must not call this. */
export function __setStoresForTest(opts: {
  approval?: ApprovalStore;
  audit?: AuditStore;
}): void {
  if (opts.approval) approvalSingleton = opts.approval;
  if (opts.audit) auditSingleton = opts.audit;
}

/** For tests — clear the singletons so the next call recomputes. */
export function __resetStores(): void {
  approvalSingleton = null;
  auditSingleton = null;
}

export { InMemoryApprovalStore, InMemoryAuditStore } from "./memory-stores";
export { KvApprovalStore, KvAuditStore } from "./kv-stores";
