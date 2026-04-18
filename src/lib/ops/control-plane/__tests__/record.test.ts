import { describe, expect, it, beforeEach } from "vitest";

import { record, requestApproval } from "../record";
import { ProhibitedActionError, recordDecision } from "../approvals";
import { newRunContext } from "../run-id";
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "../stores/memory-stores";
import { __setStoresForTest, __resetStores } from "../stores";
import { __setSurfacesForTest, __resetSurfaces } from "../slack";
import type { ApprovalRequest, AuditLogEntry } from "../types";

/**
 * End-to-end wiring test for the audit mirroring path (blueprint §15.4 T6)
 * and the gated-action path (T5c/T5d integration point).
 *
 * Uses in-memory stores + in-memory surfaces so there is zero network
 * surface area. The Slack surfaces here are stubs that capture the posts
 * they would have made — which also verifies that record() and
 * requestApproval() call the surfaces correctly.
 */

class StubApprovalSurface {
  public surfaced: ApprovalRequest[] = [];
  public updated: ApprovalRequest[] = [];

  async surfaceApproval(req: ApprovalRequest) {
    this.surfaced.push(structuredClone(req));
    return { channel: "ops-approvals" as const, ts: `ts-${req.id}` };
  }

  async updateApproval(req: ApprovalRequest) {
    this.updated.push(structuredClone(req));
  }
}

class StubAuditSurface {
  public mirrored: AuditLogEntry[] = [];
  async mirror(entry: AuditLogEntry) {
    this.mirrored.push(structuredClone(entry));
  }
}

let approvalStoreRef: InMemoryApprovalStore;
let auditStoreRef: InMemoryAuditStore;
let approvalSurfaceRef: StubApprovalSurface;
let auditSurfaceRef: StubAuditSurface;

beforeEach(() => {
  approvalStoreRef = new InMemoryApprovalStore();
  auditStoreRef = new InMemoryAuditStore();
  approvalSurfaceRef = new StubApprovalSurface();
  auditSurfaceRef = new StubAuditSurface();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({ approval: approvalStoreRef, audit: auditStoreRef });
  __setSurfacesForTest({ approval: approvalSurfaceRef, audit: auditSurfaceRef });
});

describe("record() — Class A autonomous writes", () => {
  const run = newRunContext({
    agentId: "viktor",
    division: "sales",
    source: "on-demand",
  });

  it("writes to audit store and mirrors to #ops-audit", async () => {
    const entry = await record(run, {
      actionSlug: "hubspot.task.create",
      entityType: "task",
      entityId: "t-1",
      result: "ok",
      sourceCitations: [{ system: "hubspot", id: "deal-123" }],
      confidence: 0.9,
    });
    expect(entry.action).toBe("hubspot.task.create");
    expect(await auditStoreRef._size).toBe(1);
    expect(auditSurfaceRef.mirrored).toHaveLength(1);
    expect(auditSurfaceRef.mirrored[0].id).toBe(entry.id);
  });

  it("refuses unregistered actions (fail-closed)", async () => {
    await expect(
      record(run, {
        actionSlug: "not.in.taxonomy",
        entityType: "x",
        result: "ok",
      }),
    ).rejects.toThrow(/not in the taxonomy/);
    expect(auditStoreRef._size).toBe(0);
    expect(auditSurfaceRef.mirrored).toHaveLength(0);
  });

  it("refuses Class D actions via ProhibitedActionError", async () => {
    await expect(
      record(run, {
        actionSlug: "secret.share",
        entityType: "secret",
        result: "ok",
      }),
    ).rejects.toThrow(ProhibitedActionError);
  });

  it("refuses Class B actions and directs caller to requestApproval", async () => {
    await expect(
      record(run, {
        actionSlug: "gmail.send",
        entityType: "email",
        result: "ok",
      }),
    ).rejects.toThrow(/requestApproval\(\) instead/);
  });

  it("Slack mirror failure does not fail the audit write", async () => {
    const failingSurface = {
      async mirror() {
        throw new Error("slack down");
      },
    };
    __setSurfacesForTest({ audit: failingSurface });
    const entry = await record(run, {
      actionSlug: "hubspot.task.create",
      entityType: "task",
      result: "ok",
    });
    expect(entry).toBeDefined();
    expect(auditStoreRef._size).toBe(1);
  });
});

describe("requestApproval() — Class B gated actions", () => {
  const run = newRunContext({
    agentId: "viktor",
    division: "sales",
    source: "on-demand",
  });

  const commonParams = {
    actionSlug: "gmail.send",
    targetSystem: "gmail",
    payloadPreview: "Reply to Jungle Jim's vendor setup",
    evidence: {
      claim: "Warm lead asked for vendor packet on Apr 15",
      sources: [
        { system: "gmail", id: "thread-1", retrievedAt: new Date().toISOString() },
      ],
      confidence: 0.95,
    },
    rollbackPlan: "Recall within 30 minutes",
  };

  it("opens a pending approval and surfaces it to Slack", async () => {
    const approval = await requestApproval(run, commonParams);
    expect(approval.status).toBe("pending");
    expect(approval.class).toBe("B");
    expect(approval.requiredApprovers).toEqual(["Ben"]);
    expect(approval.slackThread?.ts).toMatch(/^ts-/);
    expect(approvalSurfaceRef.surfaced).toHaveLength(1);
    expect(approvalSurfaceRef.surfaced[0].id).toBe(approval.id);
  });

  it("also writes a single approval.open audit entry", async () => {
    const approval = await requestApproval(run, commonParams);
    expect(auditStoreRef._size).toBe(1);
    const [entry] = await auditStoreRef.recent(1);
    expect(entry.action).toBe(`approval.open:${commonParams.actionSlug}`);
    expect(entry.entityType).toBe("approval");
    expect(entry.entityId).toBe(approval.id);
    expect(entry.approvalId).toBe(approval.id);
    expect(entry.confidence).toBe(0.95);
  });

  it("refuses Class D", async () => {
    await expect(
      requestApproval(run, {
        ...commonParams,
        actionSlug: "secret.share",
      }),
    ).rejects.toThrow(ProhibitedActionError);
  });

  it("refuses Class A (caller should use record() instead)", async () => {
    await expect(
      requestApproval(run, {
        ...commonParams,
        actionSlug: "hubspot.task.create",
      }),
    ).rejects.toThrow(/autonomous/);
  });

  it("class-B end-to-end: request → Ben approves → terminal; approval-surface.updateApproval was called", async () => {
    const approval = await requestApproval(run, commonParams);
    const next = await recordDecision(
      approvalStoreRef,
      approvalSurfaceRef,
      approval.id,
      { approver: "Ben", decision: "approve" },
    );
    expect(next.status).toBe("approved");
    expect(approvalSurfaceRef.updated).toHaveLength(1);
    expect(approvalSurfaceRef.updated[0].status).toBe("approved");
  });
});
