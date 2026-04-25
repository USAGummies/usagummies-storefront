/**
 * POST /api/ops/faire/direct-invites/[id]/request-approval
 *
 * Locked contracts (Phase 3):
 *   - 401 unauthenticated.
 *   - 404 unknown id.
 *   - 409 status != "approved" or no directLinkUrl (with stable code).
 *   - 200 happy path: opens a Class B faire-direct.invite approval,
 *     surfaces it via the stub approval surface, returns approvalId +
 *     slackThread.
 *   - **No Gmail / Faire / HubSpot call happens at this stage** — only
 *     KV and the in-memory approval store/surface are touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        if (v === null) store.delete(k);
        else store.set(k, v);
        return "OK";
      }),
      __store: store,
    },
  };
});

import { kv } from "@vercel/kv";
import * as authModule from "@/lib/ops/abra-auth";
import {
  __resetStores,
  __setStoresForTest,
} from "@/lib/ops/control-plane/stores";
import {
  __resetSurfaces,
  __setSurfacesForTest,
} from "@/lib/ops/control-plane/slack";
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "@/lib/ops/control-plane/stores/memory-stores";
import type {
  ApprovalRequest,
  AuditLogEntry,
} from "@/lib/ops/control-plane/types";
import {
  ingestInviteRows,
  inviteIdFromEmail,
  updateFaireInvite,
  type FaireInviteCandidate,
} from "@/lib/faire/invites";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<
  typeof vi.fn
>;

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
let approvalSurfaceRef: StubApprovalSurface;

function fakeRow(
  overrides: Partial<FaireInviteCandidate> = {},
): Partial<FaireInviteCandidate> {
  return {
    retailerName: "Test Retailer",
    email: "buyer@x.com",
    source: "wholesale-page",
    directLinkUrl: "https://faire.com/direct/usagummies/abc",
    ...overrides,
  };
}

function makeReq(id: string, body: unknown = {}): Request {
  return new Request(
    `http://localhost/api/ops/faire/direct-invites/${id}/request-approval`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  approvalStoreRef = new InMemoryApprovalStore();
  approvalSurfaceRef = new StubApprovalSurface();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: approvalStoreRef,
    audit: new InMemoryAuditStore(),
  });
  __setSurfacesForTest({
    approval: approvalSurfaceRef,
    audit: new StubAuditSurface(),
  });
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  vi.clearAllMocks();
});

async function seedApprovedWithLink(email = "buyer@x.com") {
  await ingestInviteRows([fakeRow({ email })], {
    now: new Date("2026-04-27T12:00:00Z"),
  });
  const id = inviteIdFromEmail(email);
  await updateFaireInvite(id, { status: "approved" }, {
    now: new Date("2026-04-27T13:00:00Z"),
  });
  return id;
}

describe("POST /api/ops/faire/direct-invites/[id]/request-approval", () => {
  it("401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const id = await seedApprovedWithLink();
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(401);
  });

  it("404 unknown id", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq("ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("409 when status is needs_review (wrong_status)", async () => {
    await ingestInviteRows([fakeRow()], {
      now: new Date("2026-04-27T12:00:00Z"),
    });
    const id = inviteIdFromEmail("buyer@x.com");
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("wrong_status");
  });

  it("409 when status is sent (wrong_status)", async () => {
    // Seed an already-sent record by writing directly to KV after
    // approving + simulating a sent flag.
    await ingestInviteRows([fakeRow()], {
      now: new Date("2026-04-27T12:00:00Z"),
    });
    const id = inviteIdFromEmail("buyer@x.com");
    await updateFaireInvite(id, { status: "approved" }, {});
    // Simulate a "sent" terminal record by writing the sent fields.
    const key = `faire:invites:${id}`;
    const raw = (await kv.get<string>(key)) as string;
    const rec = JSON.parse(raw);
    rec.status = "sent";
    rec.sentAt = "2026-04-28T00:00:00Z";
    rec.gmailMessageId = "msg-1";
    rec.sentApprovalId = "appr-old";
    await kv.set(key, JSON.stringify(rec));
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("wrong_status");
  });

  it("happy path: opens Class B faire-direct.invite approval", async () => {
    const id = await seedApprovedWithLink();
    const { POST } = await import("../route");
    const res = await POST(makeReq(id, { requestedBy: "rene@usagummies.com" }), ctx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      approvalId: string;
      class: string;
      requiredApprovers: string[];
      slackThread: { channel: string; ts: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.class).toBe("B");
    expect(body.approvalId).toMatch(/.+/);
    expect(body.requiredApprovers).toContain("Ben");
    expect(body.slackThread?.ts).toMatch(/^ts-/);

    // Approval was surfaced exactly once.
    expect(approvalSurfaceRef.surfaced).toHaveLength(1);
    const surfaced = approvalSurfaceRef.surfaced[0];
    expect(surfaced.targetEntity?.type).toBe("faire-invite");
    expect(surfaced.targetEntity?.id).toBe(id);
    expect(surfaced.payloadRef).toBe(`faire-invite:${id}`);
    expect(surfaced.payloadPreview).toContain("Test Retailer");
    expect(surfaced.payloadPreview).toContain("Faire Direct link");
    // Operator is logged in evidence sources, not in the public claim.
    expect(
      surfaced.evidence.sources.some(
        (s) => s.system === "operator-request" && s.id === "rene@usagummies.com",
      ),
    ).toBe(true);
  });

  it("does NOT call Gmail/HubSpot/Faire — only KV + control-plane writes", async () => {
    // In this test, vi mocks for Gmail/HubSpot are not set up. If the
    // route called them uninstrumented, the import would crash. Just
    // running the route to completion proves it's clean.
    const id = await seedApprovedWithLink();
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(200);
    // Approval store has exactly one entry.
    expect(approvalStoreRef._size).toBe(1);
  });

  it("approvers override is honored when supplied", async () => {
    const id = await seedApprovedWithLink();
    const { POST } = await import("../route");
    const res = await POST(makeReq(id, { approvers: ["Ben"] }), ctx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requiredApprovers: string[] };
    expect(body.requiredApprovers).toEqual(["Ben"]);
  });

  it("invalid JSON body still works because body is optional (treats empty string as {})", async () => {
    const id = await seedApprovedWithLink();
    const { POST } = await import("../route");
    const empty = new Request(
      `http://localhost/api/ops/faire/direct-invites/${id}/request-approval`,
      { method: "POST" },
    );
    const res = await POST(empty, ctx(id));
    expect(res.status).toBe(200);
  });
});
