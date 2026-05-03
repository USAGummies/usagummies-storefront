/**
 * Tests for the approved-shipment.create closer.
 *
 * Critical contract:
 *   - Never buys a label.
 *   - Never invents data.
 *   - Manual channel → KV queue + thread message + #shipping mirror + audit.
 *     Sample originates from Ashford via Ben (CLAUDE.md REVISED 2026-04-30).
 *   - Non-manual channel → "manual required" thread message + audit.
 *   - Refuses to handle approvals that are not in `approved` status.
 *   - Refuses payloadRefs that don't match `dispatch:<chan>:<id>`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setStoresForTest,
  __resetStores,
} from "@/lib/ops/control-plane/stores";
import {
  __setSurfacesForTest,
  __resetSurfaces,
} from "@/lib/ops/control-plane/slack";
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "@/lib/ops/control-plane/stores/memory-stores";
import type {
  ApprovalRequest,
  AuditLogEntry,
} from "@/lib/ops/control-plane/types";

// Stub the @vercel/kv module so we don't hit any real network.
vi.mock("@vercel/kv", () => {
  const store = new Map<string, string>();
  return {
    kv: {
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return "OK";
      }),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      __store: store,
    },
  };
});

// Stub the Slack client so the #shipping mirror post doesn't hit the
// real network. Tests assert against the call args. Use `vi.hoisted` so
// the mock factory can reference the spy even though `vi.mock` is
// hoisted above the rest of the file (the slack module is pulled in by
// the early `__setSurfacesForTest` import below).
const { postMessageMock } = vi.hoisted(() => ({
  postMessageMock: vi.fn(async () => ({ ok: true, ts: "fake-ts" })),
}));
vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: postMessageMock,
}));

// Channel registry stub — return `#shipping` so the manual-handoff
// branch attempts (and succeeds at) the mirror post.
vi.mock("@/lib/ops/control-plane/channels", () => ({
  getChannel: (id: string) =>
    id === "shipping"
      ? { id: "shipping", name: "#shipping", slackChannelId: "C-SHIPPING" }
      : null,
  slackChannelRef: (id: string) => {
    if (id === "shipping") return "C-SHIPPING";
    return `#${id}`;
  },
}));

import { kv } from "@vercel/kv";
import { executeApprovedShipmentCreate } from "../approval-closer";

class StubApprovalSurface {
  surfaced: ApprovalRequest[] = [];
  updated: ApprovalRequest[] = [];
  async surfaceApproval(r: ApprovalRequest) {
    this.surfaced.push(structuredClone(r));
    return { channel: "ops-approvals" as const, ts: `ts-${r.id}` };
  }
  async updateApproval(r: ApprovalRequest) {
    this.updated.push(structuredClone(r));
  }
}
class StubAuditSurface {
  mirrored: AuditLogEntry[] = [];
  async mirror(e: AuditLogEntry) {
    this.mirrored.push(structuredClone(e));
  }
}

let approvalStoreRef: InMemoryApprovalStore;
let auditStoreRef: InMemoryAuditStore;

function buildApproval(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "appr-test-1",
    runId: "run-test-1",
    division: "production-supply-chain",
    actorAgentId: "sample-order-dispatch",
    class: "B",
    action: "Create shipment (samples)",
    targetSystem: "shipstation",
    targetEntity: { type: "shipment", id: "msg-1", label: "SAMPLE-MSG-1" },
    payloadPreview: "Ship-to: Sarah · Noblesville, IN 46062",
    payloadRef: "dispatch:manual:msg-1",
    evidence: {
      claim: "Ship 1× case sample manual to Sarah",
      sources: [{ system: "manual", id: "msg-1", retrievedAt: now }],
      confidence: 0.9,
    },
    rollbackPlan: "no label bought; cancel pending dispatch",
    requiredApprovers: ["Ben"],
    status: "approved",
    createdAt: now,
    decisions: [
      { approver: "Ben", decision: "approve", decidedAt: now },
    ],
    escalateAt: now,
    expiresAt: now,
    slackThread: { channel: "ops-approvals", ts: "ts-appr-1" },
    ...overrides,
  };
}

beforeEach(() => {
  approvalStoreRef = new InMemoryApprovalStore();
  auditStoreRef = new InMemoryAuditStore();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({ approval: approvalStoreRef, audit: auditStoreRef });
  __setSurfacesForTest({
    approval: new StubApprovalSurface(),
    audit: new StubAuditSurface(),
  });
  // Reset the mocked kv map between tests.
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
  vi.clearAllMocks();
});

describe("executeApprovedShipmentCreate", () => {
  it("manual channel: queues the intent in KV, mirrors to #shipping, returns Ashford-routed thread message, never buys a label", async () => {
    const approval = buildApproval();
    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (result.ok && result.handled) {
      expect(result.kind).toBe("manual-handoff");
      if (result.kind === "manual-handoff") {
        expect(result.queuedKey).toBe(`sample-dispatch:approved:${approval.id}`);
        // Ashford / Ben routing per CLAUDE.md REVISED 2026-04-30.
        expect(result.threadMessage).toContain("Ben");
        expect(result.threadMessage).toContain("Ashford");
        // No-label-buy contract is unchanged.
        expect(result.threadMessage).toContain("No label purchased");
        // Drew / East-Coast must NOT appear — that wording was the
        // pre-2026-04-30 doctrine and shipped a stale message during the
        // 2026-05-02 CNHA repro.
        expect(result.threadMessage).not.toMatch(/Drew/i);
        expect(result.threadMessage).not.toMatch(/East Coast/i);
        // #shipping mirror succeeded with the stubbed channel registry.
        expect(result.shippingChannelPosted).toBe(true);
      }
    } else {
      throw new Error("expected handled=true");
    }

    // KV write actually fired — and it's the only write.
    expect(kv.set).toHaveBeenCalledTimes(1);
    expect(kv.set).toHaveBeenCalledWith(
      `sample-dispatch:approved:${approval.id}`,
      expect.any(String),
      expect.objectContaining({ ex: expect.any(Number) }),
    );

    // #shipping mirror posted exactly once with Ashford framing.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const postArgs = postMessageMock.mock.calls[0]![0] as {
      channel: string;
      text: string;
    };
    expect(postArgs.channel).toBe("C-SHIPPING");
    expect(postArgs.text).toContain("Ashford");
    expect(postArgs.text).not.toMatch(/Drew/i);

    // Audit recorded.
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(1);
  });

  it("non-manual channel: returns 'manual required' message — does NOT touch KV queue or #shipping mirror", async () => {
    const approval = buildApproval({
      payloadRef: "dispatch:shopify:1234",
      targetEntity: { type: "shipment", id: "1234", label: "#1234" },
    });
    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (result.ok && result.handled) {
      expect(result.kind).toBe("auto-ship-pipeline-handoff");
      if (result.kind === "auto-ship-pipeline-handoff") {
        expect(result.threadMessage).toContain("Manual required for label buy");
        expect(result.threadMessage).toContain("shopify");
      }
    } else {
      throw new Error("expected handled=true");
    }

    // Critical: no KV write for non-manual channels (those route through
    // the dedicated auto-ship cron, not this closer's queue).
    expect(kv.set).not.toHaveBeenCalled();
    // And no #shipping mirror — the auto-ship cron handles that surface.
    expect(postMessageMock).not.toHaveBeenCalled();

    // Audit still recorded.
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(1);
  });

  it("refuses to fire for approvals that are not in 'approved' state", async () => {
    const approval = buildApproval({ status: "pending", decisions: [] });
    const result = await executeApprovedShipmentCreate(approval);
    expect(result.handled).toBe(false);
    if (!result.handled) {
      expect(result.reason).toMatch(/pending/);
    }
    expect(kv.set).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("rejects approvals missing a parsable dispatch payloadRef (no guessing)", async () => {
    const approval = buildApproval({ payloadRef: "garbage" });
    const result = await executeApprovedShipmentCreate(approval);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/payloadRef/);
    }
    expect(kv.set).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("does NOT call any ShipStation / label-buying primitive", async () => {
    // Spy on every export of the shipstation-client module to prove the
    // closer never reaches into the label-buying path.
    const ssMod = await import("@/lib/ops/shipstation-client");
    const fnNames = Object.keys(ssMod).filter(
      (k) => typeof (ssMod as Record<string, unknown>)[k] === "function",
    );
    const spies = fnNames.map((name) =>
      vi.spyOn(
        ssMod as unknown as Record<string, (...args: unknown[]) => unknown>,
        name,
      ),
    );

    await executeApprovedShipmentCreate(buildApproval());

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
