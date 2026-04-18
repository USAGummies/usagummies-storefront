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
import type {
  CorrectionStore,
  PauseSink,
  ViolationStore,
} from "../enforcement";
import {
  InMemoryCorrectionStore,
  InMemoryPauseSink,
  InMemoryViolationStore,
} from "../enforcement";

import { InMemoryApprovalStore, InMemoryAuditStore } from "./memory-stores";
import { KvApprovalStore, KvAuditStore } from "./kv-stores";
import {
  KvCorrectionStore,
  KvPauseSink,
  KvViolationStore,
} from "./kv-enforcement";

// Process-level singletons so successive calls share state.
let approvalSingleton: ApprovalStore | null = null;
let auditSingleton: AuditStore | null = null;
let pauseSingleton: PauseSink | null = null;
let violationSingleton: ViolationStore | null = null;
let correctionSingleton: CorrectionStore | null = null;

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

export function pauseSink(): PauseSink {
  if (pauseSingleton) return pauseSingleton;
  pauseSingleton = isCloud() ? new KvPauseSink() : new InMemoryPauseSink();
  return pauseSingleton;
}

export function violationStore(): ViolationStore {
  if (violationSingleton) return violationSingleton;
  violationSingleton = isCloud() ? new KvViolationStore() : new InMemoryViolationStore();
  return violationSingleton;
}

export function correctionStore(): CorrectionStore {
  if (correctionSingleton) return correctionSingleton;
  correctionSingleton = isCloud() ? new KvCorrectionStore() : new InMemoryCorrectionStore();
  return correctionSingleton;
}

/** For tests — swap in a fixture. Production code must not call this. */
export function __setStoresForTest(opts: {
  approval?: ApprovalStore;
  audit?: AuditStore;
  pause?: PauseSink;
  violation?: ViolationStore;
  correction?: CorrectionStore;
}): void {
  if (opts.approval) approvalSingleton = opts.approval;
  if (opts.audit) auditSingleton = opts.audit;
  if (opts.pause) pauseSingleton = opts.pause;
  if (opts.violation) violationSingleton = opts.violation;
  if (opts.correction) correctionSingleton = opts.correction;
}

/** For tests — clear the singletons so the next call recomputes. */
export function __resetStores(): void {
  approvalSingleton = null;
  auditSingleton = null;
  pauseSingleton = null;
  violationSingleton = null;
  correctionSingleton = null;
}

export { InMemoryApprovalStore, InMemoryAuditStore } from "./memory-stores";
export { KvApprovalStore, KvAuditStore } from "./kv-stores";
export {
  KvCorrectionStore,
  KvPauseSink,
  KvViolationStore,
} from "./kv-enforcement";
export {
  InMemoryCorrectionStore,
  InMemoryPauseSink,
  InMemoryViolationStore,
} from "../enforcement";
