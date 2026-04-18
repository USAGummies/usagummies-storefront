/**
 * In-memory stores for ApprovalRequest + AuditLogEntry.
 *
 * Purpose:
 *   - Unit tests (fast, deterministic, no network)
 *   - Local dev fallback when VERCEL env is absent
 *   - Deterministic reference implementation that the KV adapters must match
 *
 * Concurrency: these implementations are NOT safe for concurrent multi-request
 * server use. Production on Vercel uses KvApprovalStore / KvAuditStore
 * (see kv-stores.ts). Memory stores are single-process fixtures.
 */

import type { ApprovalRequest, AuditLogEntry } from "../types";
import type { ApprovalStore } from "../approvals";
import type { AuditStore } from "../audit";

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>();

  async put(request: ApprovalRequest): Promise<void> {
    this.byId.set(request.id, structuredClone(request));
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const found = this.byId.get(id);
    return found ? structuredClone(found) : null;
  }

  async listPending(): Promise<ApprovalRequest[]> {
    return [...this.byId.values()]
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => structuredClone(r));
  }

  async listByAgent(agentId: string, limit = 100): Promise<ApprovalRequest[]> {
    return [...this.byId.values()]
      .filter((r) => r.actorAgentId === agentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  // test helper — not part of ApprovalStore interface
  _clear(): void {
    this.byId.clear();
  }

  get _size(): number {
    return this.byId.size;
  }
}

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async recent(limit: number): Promise<AuditLogEntry[]> {
    return this.entries
      .slice()
      .reverse()
      .slice(0, Math.max(0, limit))
      .map((e) => structuredClone(e));
  }

  async byRun(runId: string): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => structuredClone(e));
  }

  async byAgent(agentId: string, sinceISO: string): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.actorId === agentId && e.createdAt >= sinceISO)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => structuredClone(e));
  }

  async byAction(action: string, limit: number): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.action === action)
      .slice()
      .reverse() // newest-first
      .slice(0, Math.max(0, limit))
      .map((e) => structuredClone(e));
  }

  // test helper
  _clear(): void {
    this.entries.length = 0;
  }

  get _size(): number {
    return this.entries.length;
  }
}
