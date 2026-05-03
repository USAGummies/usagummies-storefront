/**
 * Tests for the approved-shipment.create closer.
 *
 * Critical contract:
 *   - Never buys a label.
 *   - Never invents data.
 *   - Manual channel + persisted payload + ShipStation OK
 *       → creates a ShipStation order in awaiting_shipment, KV-marks
 *         idempotency, mirrors to #shipping with the order link.
 *   - Manual channel + ShipStation API failure
 *       → falls back to the legacy manual-handoff message; audits the
 *         failure; never throws.
 *   - Manual channel + no persisted payload (legacy approval)
 *       → falls back to the legacy manual-handoff message; ShipStation
 *         is never called.
 *   - Idempotency: a second invocation with a marker present skips the
 *     create and returns the prior orderId.
 *   - Non-manual channel → "manual required" thread message + audit.
 *   - Refuses to handle approvals that are not in `approved` status.
 *   - Refuses payloadRefs that don't match a known format.
 *
 * Sample originates from Ashford via Ben (CLAUDE.md REVISED 2026-04-30 +
 * /contracts/integrations/shipstation.md §3.5).
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
import type {
  DispatchClassification,
  OrderIntent,
} from "@/lib/ops/sample-order-dispatch";
import type { DispatchPayload } from "@/lib/ops/sample-order-dispatch/payload-store";

// Stub the @vercel/kv module so we don't hit any real network. The
// store map is shared so the closer can read what the test seeded.
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
// hoisted above the rest of the file.
type PostMessageArg = { channel: string; text: string };
const { postMessageMock } = vi.hoisted(() => ({
  postMessageMock: vi.fn(async (_args: { channel: string; text: string }) => ({
    ok: true,
    ts: "fake-ts",
  })),
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

// Stub the ShipStation client. Default = ShipStation configured + a
// successful createOrder response. Per-test overrides via the spies.
// Mocks are typed as `unknown` args + union return so per-test
// `mockImplementationOnce` can return either an ok or an error shape.
const { isShipStationConfiguredMock, createShipStationOrderMock } = vi.hoisted(
  () => ({
    isShipStationConfiguredMock: vi.fn((): boolean => true),
    createShipStationOrderMock: vi.fn(
      async (_args: Record<string, unknown>): Promise<unknown> => ({
        ok: true,
        order: {
          orderId: 999_001,
          orderNumber: "sample-test-source-1",
          orderUrl:
            "https://ship.shipstation.com/orders/all-orders-search-result?quickSearch=sample-test-source-1",
        },
      }),
    ),
  }),
);
vi.mock("@/lib/ops/shipstation-client", () => ({
  isShipStationConfigured: isShipStationConfiguredMock,
  createShipStationOrder: createShipStationOrderMock,
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

function buildPayload(overrides: Partial<OrderIntent> = {}): DispatchPayload {
  const intent: OrderIntent = {
    channel: "manual",
    sourceId: "msg-1",
    orderNumber: "msg-1",
    tags: ["sample", "tag:sample"],
    note: "Sample request from Sarah at CNHA portal",
    shipTo: {
      name: "Sarah Buyer",
      company: "CNHA",
      street1: "100 Buyer Way",
      city: "Noblesville",
      state: "IN",
      postalCode: "46062",
      country: "US",
    },
    packagingType: "case",
    cartons: 1,
    weightLbs: 6,
    ...overrides,
  };
  const classification: DispatchClassification = {
    origin: "ashford",
    originReason:
      "samples ship from Ashford per /contracts/integrations/shipstation.md §3.5",
    carrierCode: "stamps_com",
    serviceCode: "usps_ground_advantage",
    packagingType: "case",
    cartons: 1,
    warnings: [],
    refuse: false,
  };
  return {
    approvalId: "appr-test-1",
    orderIntent: intent,
    classification,
    payloadRef: "dispatch:manual:msg-1",
    persistedAt: new Date().toISOString(),
  };
}

function seedPayload(approvalId: string, payload: DispatchPayload) {
  const store = (kv as unknown as { __store: Map<string, string> }).__store;
  store.set(`sample-dispatch:payload:${approvalId}`, JSON.stringify(payload));
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
  // Re-establish default mock implementations after clearAllMocks.
  isShipStationConfiguredMock.mockImplementation(() => true);
  createShipStationOrderMock.mockImplementation(async () => ({
    ok: true as const,
    order: {
      orderId: 999_001,
      orderNumber: "sample-test-source-1",
      orderUrl:
        "https://ship.shipstation.com/orders/all-orders-search-result?quickSearch=sample-test-source-1",
    },
  }));
});

describe("executeApprovedShipmentCreate", () => {
  it("manual channel + persisted payload: creates ShipStation order, marks idempotency, posts to #shipping with the order link", async () => {
    const approval = buildApproval();
    seedPayload(approval.id, buildPayload());

    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    expect(result.kind).toBe("manual-handoff");
    if (result.kind !== "manual-handoff") throw new Error("kind mismatch");

    expect(result.queuedKey).toBe(`sample-dispatch:approved:${approval.id}`);
    expect(result.shipStationOrderId).toBe(999_001);
    expect(result.shipStationOrderNumber).toBe("sample-test-source-1");
    expect(result.shipStationOrderUrl).toContain("ship.shipstation.com");
    expect(result.shipStationFallbackReason).toBeUndefined();

    // Thread message references the ShipStation order.
    expect(result.threadMessage).toContain("ShipStation order");
    expect(result.threadMessage).toContain("sample-test-source-1");
    expect(result.threadMessage).toContain("Ashford");
    expect(result.threadMessage).toContain("No label purchased");
    expect(result.threadMessage).not.toMatch(/Drew/i);
    expect(result.threadMessage).not.toMatch(/East Coast/i);

    // ShipStation called exactly once with the §3.5 canonical spec.
    expect(createShipStationOrderMock).toHaveBeenCalledTimes(1);
    const ssCall = createShipStationOrderMock.mock.calls[0];
    if (!ssCall) throw new Error("expected createShipStationOrder call");
    const ssArgs = ssCall[0] as Record<string, unknown>;
    expect(ssArgs.orderStatus).toBe("awaiting_shipment");
    expect(ssArgs.weight).toEqual({ value: 3.4, units: "pounds" });
    expect(ssArgs.dimensions).toMatchObject({
      length: 7,
      width: 7,
      height: 7,
      units: "inches",
    });
    expect(ssArgs.items).toEqual([
      {
        sku: "UG-AAGB-6CT",
        name: "All American Gummy Bears 7.5oz Sample Case (6-ct)",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
    expect(ssArgs.customField1).toContain("tag:sample");
    expect(ssArgs.customField1).toContain("tag:no-revenue");
    expect(ssArgs.customField2).toBe("origin:ashford");
    expect(ssArgs.customField3).toBe(`approval:${approval.id}`);
    expect(ssArgs.shipTo).toMatchObject({
      name: "Sarah Buyer",
      city: "Noblesville",
      state: "IN",
      postalCode: "46062",
    });

    // KV: queue marker + idempotency marker.
    const kvSet = vi.mocked(kv.set);
    const setKeys = kvSet.mock.calls.map((c) => c[0] as string);
    expect(setKeys).toContain(`sample-dispatch:approved:${approval.id}`);
    expect(setKeys).toContain(
      `sample-dispatch:shipstation-order:${approval.id}`,
    );

    // #shipping mirror posted exactly once with the SS order link.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const postCall = postMessageMock.mock.calls[0];
    if (!postCall) throw new Error("expected postMessage call");
    const postArgs = postCall[0] as PostMessageArg;
    expect(postArgs.channel).toBe("C-SHIPPING");
    expect(postArgs.text).toContain("ShipStation");
    expect(postArgs.text).toContain("sample-test-source-1");
    expect(postArgs.text).toContain("Auto-ship cron");
    expect(postArgs.text).not.toMatch(/Drew/i);

    // Audit entries: handoff + shipstation-order-created.
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(2);
  });

  it("manual channel + ShipStation API failure: falls back to legacy manual-handoff path; audits the failure", async () => {
    const approval = buildApproval();
    seedPayload(approval.id, buildPayload());
    createShipStationOrderMock.mockImplementationOnce(
      async (): Promise<unknown> => ({
        ok: false,
        error: "ShipStation 503: service unavailable",
      }),
    );

    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    if (result.kind !== "manual-handoff") throw new Error("kind mismatch");

    // No SS order id / url in the result.
    expect(result.shipStationOrderId).toBeUndefined();
    expect(result.shipStationOrderUrl).toBeUndefined();
    expect(result.shipStationFallbackReason).toContain("503");

    // Thread message uses the LEGACY manual-handoff wording so Ben
    // knows he has to pack + label by hand.
    expect(result.threadMessage).toContain("queued for Ben to pack from Ashford");
    expect(result.threadMessage).toContain("No label purchased");
    expect(result.threadMessage).toContain("ShipStation auto-create skipped");

    // Critical: idempotency marker MUST NOT be set when create failed —
    // otherwise a retry would skip and we'd never recover.
    const kvSet = vi.mocked(kv.set);
    const setKeys = kvSet.mock.calls.map((c) => c[0] as string);
    expect(setKeys).toContain(`sample-dispatch:approved:${approval.id}`);
    expect(setKeys).not.toContain(
      `sample-dispatch:shipstation-order:${approval.id}`,
    );

    // #shipping mirror still fires with the fallback wording.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const postCall = postMessageMock.mock.calls[0];
    if (!postCall) throw new Error("expected postMessage call");
    const postArgs = postCall[0] as PostMessageArg;
    expect(postArgs.text).toContain("Ashford");
    expect(postArgs.text).toContain("ShipStation auto-create skipped");
    expect(postArgs.text).not.toContain("ShipStation order: `sample-test");

    // Audit recorded both the failure and the handoff.
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(2);
  });

  it("manual channel + no persisted payload (legacy approval): skips ShipStation, falls back to manual-handoff message", async () => {
    const approval = buildApproval();
    // Intentionally do NOT seed a payload — simulates a pre-2026-05-02
    // approval that lacks the structured payload.

    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    if (result.kind !== "manual-handoff") throw new Error("kind mismatch");

    expect(result.shipStationOrderId).toBeUndefined();
    expect(result.shipStationFallbackReason).toMatch(
      /no structured dispatch payload/i,
    );

    // ShipStation should never have been called when payload is missing.
    expect(createShipStationOrderMock).not.toHaveBeenCalled();

    // Thread message preserves the legacy hand-off wording.
    expect(result.threadMessage).toContain("queued for Ben to pack from Ashford");
    expect(result.threadMessage).not.toMatch(/Drew/i);
    expect(result.threadMessage).not.toMatch(/East Coast/i);

    // #shipping mirror still posts.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it("idempotency: second invocation with a stored marker reuses the prior ShipStation order id and skips create", async () => {
    const approval = buildApproval();
    seedPayload(approval.id, buildPayload());

    // Pre-seed the idempotency marker as if a prior run created it.
    const store = (kv as unknown as { __store: Map<string, string> }).__store;
    store.set(
      `sample-dispatch:shipstation-order:${approval.id}`,
      JSON.stringify({
        orderId: 555_555,
        orderNumber: "prior-source-1",
        orderUrl: "https://ship.shipstation.com/orders/prior",
      }),
    );

    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    if (result.kind !== "manual-handoff") throw new Error("kind mismatch");

    // Reused the pre-existing order — never called createShipStationOrder.
    expect(createShipStationOrderMock).not.toHaveBeenCalled();
    expect(result.shipStationOrderId).toBe(555_555);
    expect(result.shipStationOrderNumber).toBe("prior-source-1");

    // Thread message references the prior order.
    expect(result.threadMessage).toContain("prior-source-1");
  });

  it("manual channel + ShipStation not configured: skips create, falls back to manual-handoff", async () => {
    const approval = buildApproval();
    seedPayload(approval.id, buildPayload());
    isShipStationConfiguredMock.mockImplementationOnce(() => false);

    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    if (result.kind !== "manual-handoff") throw new Error("kind mismatch");

    expect(createShipStationOrderMock).not.toHaveBeenCalled();
    expect(result.shipStationOrderId).toBeUndefined();
    expect(result.shipStationFallbackReason).toMatch(/not configured/i);
    expect(result.threadMessage).toContain("queued for Ben to pack from Ashford");
  });

  it("accepts sample-queue:<sourceId> payloadRef and treats it as the manual channel", async () => {
    const approval = buildApproval({
      payloadRef: "sample-queue:sample-queue-1234567890-abc",
      targetEntity: {
        type: "shipment",
        id: "sample-queue-1234567890-abc",
        label: "Sample · Sarah Buyer",
      },
    });
    seedPayload(
      approval.id,
      buildPayload({
        sourceId: "sample-queue-1234567890-abc",
        orderNumber: "sample-queue-1234567890-abc",
      }),
    );

    const result = await executeApprovedShipmentCreate(approval);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    expect(result.kind).toBe("manual-handoff");
    expect(createShipStationOrderMock).toHaveBeenCalledTimes(1);
  });

  it("non-manual channel: returns 'manual required' message — does NOT touch KV queue, ShipStation, or #shipping mirror", async () => {
    const approval = buildApproval({
      payloadRef: "dispatch:shopify:1234",
      targetEntity: { type: "shipment", id: "1234", label: "#1234" },
    });
    const result = await executeApprovedShipmentCreate(approval);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.handled) throw new Error("expected handled=true");
    expect(result.kind).toBe("auto-ship-pipeline-handoff");
    if (result.kind === "auto-ship-pipeline-handoff") {
      expect(result.threadMessage).toContain("Manual required for label buy");
      expect(result.threadMessage).toContain("shopify");
    }

    // Critical: no KV write for non-manual channels (those route through
    // the dedicated auto-ship cron, not this closer's queue).
    expect(kv.set).not.toHaveBeenCalled();
    // No #shipping mirror — the auto-ship cron handles that surface.
    expect(postMessageMock).not.toHaveBeenCalled();
    // No ShipStation create — non-manual orders are already in
    // ShipStation via marketplace sync.
    expect(createShipStationOrderMock).not.toHaveBeenCalled();

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
    expect(createShipStationOrderMock).not.toHaveBeenCalled();
  });

  it("rejects approvals missing a parsable payloadRef (no guessing)", async () => {
    const approval = buildApproval({ payloadRef: "garbage" });
    const result = await executeApprovedShipmentCreate(approval);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/payloadRef/);
    }
    expect(kv.set).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
    expect(createShipStationOrderMock).not.toHaveBeenCalled();
  });

  it("does NOT call any LABEL-buying primitive — only createShipStationOrder is allowed", async () => {
    // Sanity check: the closer is allowed to call createShipStationOrder
    // (which creates an awaiting_shipment entry — no money spent), but
    // never any of the label-buying or void/restore primitives. The
    // mock module surface here only exposes the two closer-allowed
    // exports; if anyone wires in createShippingLabel /
    // createLabelForShipStationOrder / etc., the test will fail at
    // import time.
    const approval = buildApproval();
    seedPayload(approval.id, buildPayload());
    await executeApprovedShipmentCreate(approval);

    // The mocked module only exposes the two closer-allowed functions.
    // If a future change adds a label-buying call, this test still
    // verifies the only ShipStation primitive used is createShipStationOrder.
    expect(createShipStationOrderMock).toHaveBeenCalledTimes(1);
  });
});
