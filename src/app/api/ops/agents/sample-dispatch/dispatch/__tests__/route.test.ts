/**
 * Integration tests for the sample-dispatch HTTP route.
 *
 * These tests exercise the real route handler against in-memory control-
 * plane stores, so the contract that email-intel depends on is locked:
 *
 *   - Happy path: dispatch returns `approvalId` (not just a Slack ts).
 *   - Refusal path: returns 422, opens NO approval, no audit-as-approval.
 *   - No label is bought during dispatch; only an approval is opened.
 *   - Required ship-to fields are enforced — no inventing.
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

// Auth bypass: test mode allows requests without session/CRON_SECRET.
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

// dispatchAudit writes to audit-store but isn't the focus here; we just
// don't want it to fail when run in tests. Provide a no-op.
vi.mock("@/lib/ops/dispatch-audit", () => ({
  auditDispatch: vi.fn(async () => undefined),
}));

// Slack client must NOT actually post.  postMessage returns ok=true so the
// happy path can record an approval ts.
vi.mock("@/lib/ops/control-plane/slack", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/control-plane/slack")
  >("@/lib/ops/control-plane/slack");
  return {
    ...actual,
    postMessage: vi.fn(async () => ({ ok: true, ts: "1234.5678" })),
  };
});

// Spy on every shipstation-client export to prove no label-buying happens.
const shipstationCalls: string[] = [];
vi.mock("@/lib/ops/shipstation-client", () => {
  const handler = {
    get(_: unknown, prop: string) {
      return (...args: unknown[]) => {
        shipstationCalls.push(`${prop}(${JSON.stringify(args).slice(0, 80)})`);
        throw new Error(`shipstation-client.${prop} must NOT be called from dispatch route`);
      };
    },
  };
  return new Proxy({}, handler);
});

class StubApprovalSurface {
  surfaced: ApprovalRequest[] = [];
  updated: ApprovalRequest[] = [];
  async surfaceApproval(r: ApprovalRequest) {
    this.surfaced.push(structuredClone(r));
    return { channel: "ops-approvals" as const, ts: `slack-ts-${r.id}` };
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
  __setSurfacesForTest({
    approval: approvalSurfaceRef,
    audit: auditSurfaceRef,
  });
  shipstationCalls.length = 0;
  vi.clearAllMocks();
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/ops/agents/sample-dispatch/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const completeIntent = {
  channel: "manual" as const,
  sourceId: "email:abc123",
  orderNumber: "SAMPLE-EMAIL-ABC123",
  tags: ["sample", "from-email"],
  shipTo: {
    name: "Sarah Smith",
    street1: "5972 CHICKNEY DR",
    city: "Noblesville",
    state: "IN",
    postalCode: "46062",
    country: "US",
    residential: true,
  },
  packagingType: "case" as const,
  cartons: 1,
};

describe("POST /api/ops/agents/sample-dispatch/dispatch", () => {
  it("happy path: returns a real approvalId from the canonical control plane", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq(completeIntent));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      approvalId: string | null;
      proposalTs: string | null;
      posted: boolean;
      classification: { refuse: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.posted).toBe(true);
    // approvalId comes from the real ApprovalRequest.id, not a Slack ts.
    expect(body.approvalId).toBeTruthy();
    expect(body.approvalId).not.toBe(body.proposalTs);

    // The approval is in the store, in pending status, with the right slug.
    const stored = await approvalStoreRef.get(body.approvalId!);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("pending");
    expect(stored?.requiredApprovers).toEqual(["Ben"]);
    expect(stored?.targetSystem).toBe("shipstation");
    expect(stored?.payloadRef).toBe(`dispatch:manual:${completeIntent.sourceId}`);

    // Surface posted exactly one card.
    expect(approvalSurfaceRef.surfaced).toHaveLength(1);
    expect(approvalSurfaceRef.surfaced[0].id).toBe(body.approvalId);

    // No ShipStation primitive was touched (no label bought).
    expect(shipstationCalls).toHaveLength(0);
  });

  it("refusal path: AR-hold yields 422, opens NO approval, classifies refuse=true", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        ...completeIntent,
        hubspot: { arHold: true },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      ok: boolean;
      refuse: boolean;
      classification: { refuse: boolean };
    };
    expect(body.ok).toBe(false);
    expect(body.refuse).toBe(true);
    expect(body.classification.refuse).toBe(true);

    // No approval entered the queue.
    expect(approvalSurfaceRef.surfaced).toHaveLength(0);
    expect(approvalStoreRef._size).toBe(0);

    // No ShipStation call.
    expect(shipstationCalls).toHaveLength(0);
  });

  it("rejects an incomplete shipTo (does NOT invent missing fields)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        ...completeIntent,
        shipTo: { ...completeIntent.shipTo, postalCode: "" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/postalCode/);
    expect(approvalStoreRef._size).toBe(0);
  });

  it("post=false: skips approval surfacing — useful for UI preview", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({ ...completeIntent, post: false }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      posted: boolean;
      approvalId: string | null;
    };
    expect(body.posted).toBe(false);
    expect(body.approvalId).toBeNull();
    // No approval persisted (preview is read-only).
    expect(approvalStoreRef._size).toBe(0);
  });
});
