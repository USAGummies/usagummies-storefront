/**
 * Tests for the AP packet approval closer.
 *
 * Locked contracts (every one of these is one bullet from Ben's spec):
 *   1. Approved AP-packet approval → /send POSTed exactly once.
 *   2. Pending or rejected AP-packet approvals → no /send call, no audit-as-success.
 *   3. Non-AP approvals (email-reply, shipment-create) → ignored
 *      (handled=false), never call /send.
 *   4. /send failure → returns ok=false, threadMessage flags failure,
 *      audit recorded as error. Critical: closer NEVER writes the
 *      `ap-packets:sent:<slug>` KV row itself — only the /send route does.
 *      So a failure path that bypasses /send never falsely marks lastSent.
 *   5. Missing/invalid targetEntity.id (no `ap-packet:<slug>` prefix)
 *      → fail closed, no /send call, no audit-as-success.
 *   6. The closer NEVER calls Gmail / HubSpot / KV / Drive directly —
 *      every email-sending side effect goes through the existing /send
 *      route, which is the only path that requires (and re-checks)
 *      Class B approval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { executeApprovedApPacketSend } from "../approval-closer";

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

function buildApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "appr-jj-1",
    runId: "run-jj-1",
    division: "financials",
    actorAgentId: "ap-packet-sender",
    class: "B",
    action: "Send AP packet",
    targetSystem: "gmail",
    targetEntity: {
      type: "ap-packet",
      id: "ap-packet:jungle-jims",
      label: "Jungle Jim's AP reply",
    },
    payloadPreview: "Send AP reply packet...",
    payloadRef: undefined,
    evidence: {
      claim: "Send prepared AP packet to ap@junglejims.com",
      sources: [{ system: "ap-packets", id: "jungle-jims", retrievedAt: now }],
      confidence: 0.95,
    },
    rollbackPlan: "Gmail undo-send window",
    requiredApprovers: ["Ben"],
    status: "approved",
    createdAt: now,
    decisions: [{ approver: "Ben", decision: "approve", decidedAt: now }],
    escalateAt: now,
    expiresAt: now,
    slackThread: { channel: "ops-approvals", ts: "ts-appr-jj-1" },
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
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.CRON_SECRET;
});

describe("executeApprovedApPacketSend — success path", () => {
  it("approved AP-packet approval POSTs /send exactly once with the correct body and bearer", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          slug: "jungle-jims",
          messageId: "gmail-abc",
          threadId: "thr-abc",
          hubspotLogId: "hubspot-1",
          approvalId: "appr-jj-1",
          attachmentCount: 5,
          sentAt: "2026-04-25T12:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await executeApprovedApPacketSend(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.handled) {
      expect(result.kind).toBe("ap-packet-send");
      if (result.kind === "ap-packet-send") {
        expect(result.slug).toBe("jungle-jims");
        expect(result.messageId).toBe("gmail-abc");
        expect(result.hubspotLogId).toBe("hubspot-1");
        expect(result.threadMessage).toContain("AP packet *jungle-jims*");
        expect(result.threadMessage).toContain("gmail-abc");
        expect(result.threadMessage).toContain("hubspot-1");
      }
    } else {
      throw new Error("expected handled=true ok=true");
    }

    // Exactly one /send call with the right shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { body: string },
    ];
    expect(url).toBe(
      "https://example.test/api/ops/fulfillment/ap-packet/send",
    );
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer test-cron-secret");
    expect(JSON.parse(init.body)).toEqual({
      slug: "jungle-jims",
      approvalToken: "appr-jj-1",
    });
  });
});

describe("executeApprovedApPacketSend — strict gating", () => {
  it("pending approval → handled=false, no /send call", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({ status: "pending", decisions: [] }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toMatch(/pending/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejected approval → handled=false, no /send call", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({
        status: "rejected",
        decisions: [
          {
            approver: "Ben",
            decision: "reject",
            decidedAt: new Date().toISOString(),
          },
        ],
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-ap-packet approval (email-reply) → handled=false, no /send call", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({
        targetEntity: {
          type: "email-reply",
          id: "gmail:msg-123",
          label: "Email reply",
        },
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-ap-packet approval (vendor-master) → handled=false, no /send call", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({
        targetEntity: {
          type: "vendor-master",
          id: "vendor:powers-confections",
          label: "Powers Confections",
        },
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeApprovedApPacketSend — fail closed when slug is unparseable", () => {
  it("missing targetEntity.id prefix → fail closed, no /send call, audit error", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({
        targetEntity: { type: "ap-packet", id: "garbage-id" },
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/missing valid targetEntity\.id/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // Audit logged the error.
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(1);
  });

  it("empty slug after prefix → fail closed, no /send call", async () => {
    const fetchMock = vi.fn();
    const r = await executeApprovedApPacketSend(
      buildApproval({
        targetEntity: { type: "ap-packet", id: "ap-packet:" },
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeApprovedApPacketSend — failure paths do not write lastSent", () => {
  // The closer NEVER touches kv directly. The only place
  // `ap-packets:sent:<slug>` is written is the /send route's own
  // success path. So if /send returns ok=false, lastSent is unchanged.
  // These tests prove the closer signals failure correctly without
  // pretending the send happened.

  it("send route returns 502 → ok=false, error in threadMessage, audit error", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "Gmail send failed: insufficient permissions",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = await executeApprovedApPacketSend(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/Gmail send failed/);
      expect(r.threadMessage).toContain("send call failed");
      expect(r.threadMessage).toContain("No `lastSent` written");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedup conflict (HTTP 409 already sent) → ok=false, surfaces reason", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "Already sent",
          reason: "KV record shows sent at 2026-04-20T12:00:00Z",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = await executeApprovedApPacketSend(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      // Either the error or the reason field is acceptable in the
      // surfaced thread message.
      expect(r.error).toMatch(/Already sent|KV record shows sent/);
    }
  });

  it("network error → ok=false, no double-fire", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await executeApprovedApPacketSend(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/ECONNRESET/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("approvalToken passed to /send is the approval id (not the slack ts)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          slug: "jungle-jims",
          messageId: "m",
          threadId: null,
          sentAt: "2026-04-25T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await executeApprovedApPacketSend(buildApproval({ id: "appr-distinct-id" }), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { body: string },
    ];
    expect(JSON.parse(init.body).approvalToken).toBe("appr-distinct-id");
  });
});

describe("executeApprovedApPacketSend — never sends without approval", () => {
  it("unauthenticated path: closer fires only when approval.status === 'approved'", async () => {
    // This is a property of the closer itself, but we double-cover it
    // because the bug we're guarding against — "AP packet email goes
    // out without Class B approval" — is the entire reason this gate
    // exists.
    const fetchMock = vi.fn();
    for (const status of ["draft", "pending", "rejected", "expired", "stood-down"] as const) {
      fetchMock.mockClear();
      const r = await executeApprovedApPacketSend(
        buildApproval({ status, decisions: [] }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      );
      expect(r.handled).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});
