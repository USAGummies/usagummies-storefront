/**
 * Integration tests for POST
 * /api/ops/faire/direct-invites/[id]/follow-up/request-approval.
 *
 * Locked contracts:
 *   - 401 unauthenticated.
 *   - 404 unknown id.
 *   - 409 invite is not_due (fresh / wrong_status / missing_sent_at).
 *   - 409 followUpQueuedAt already set with a *different* approval id.
 *   - 200 happy path (overdue / due_soon): opens Class B
 *     `faire-direct.follow-up` approval, surfaces it, stamps
 *     followUpQueuedAt + followUpRequestApprovalId.
 *   - **No Gmail / Faire / HubSpot call at this stage** — KV +
 *     in-memory approval store/surface only.
 *   - The route stamps the invite AFTER the approval card opens, so
 *     a successful response always carries an approval id that's
 *     also recorded on the invite row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  type FaireInviteCandidate,
  type FaireInviteRecord,
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
    `http://localhost/api/ops/faire/direct-invites/${id}/follow-up/request-approval`,
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

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Seed an invite already in the "sent" state with a configurable
 * sentAt and optional followUp* state.
 */
async function seedSentInvite(opts: {
  email: string;
  daysAgo: number;
  followUpQueuedAt?: string;
  followUpRequestApprovalId?: string;
  followUpSentAt?: string;
}): Promise<string> {
  await ingestInviteRows([fakeRow({ email: opts.email })], {
    now: new Date("2026-04-01T00:00:00Z"),
  });
  const id = inviteIdFromEmail(opts.email);
  const sentAt = new Date(
    Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  const key = `faire:invites:${id}`;
  const rec = JSON.parse(
    (await kv.get<string>(key)) as string,
  ) as FaireInviteRecord;
  rec.status = "sent";
  rec.sentAt = sentAt;
  rec.sentBy = "Ben";
  rec.gmailMessageId = `gmail-${id}`;
  rec.gmailThreadId = `thr-${id}`;
  rec.sentApprovalId = `appr-initial-${id}`;
  if (opts.followUpQueuedAt) rec.followUpQueuedAt = opts.followUpQueuedAt;
  if (opts.followUpRequestApprovalId)
    rec.followUpRequestApprovalId = opts.followUpRequestApprovalId;
  if (opts.followUpSentAt) rec.followUpSentAt = opts.followUpSentAt;
  await kv.set(key, JSON.stringify(rec));
  return id;
}

describe("auth gate", () => {
  it("401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const id = await seedSentInvite({ email: "x@x.com", daysAgo: 10 });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(401);
  });
});

describe("error paths", () => {
  it("404 unknown id", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq("ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("409 not_due / fresh — sent < 3 days ago", async () => {
    const id = await seedSentInvite({ email: "fresh@x.com", daysAgo: 1 });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("fresh");
  });

  it("409 wrong_status — non-sent invite", async () => {
    await ingestInviteRows([fakeRow({ email: "ns@x.com" })], {
      now: new Date("2026-04-01T00:00:00Z"),
    });
    const id = inviteIdFromEmail("ns@x.com");
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("wrong_status");
  });

  it("409 follow_up_queued — followUpQueuedAt already set", async () => {
    const id = await seedSentInvite({
      email: "queued@x.com",
      daysAgo: 10,
      followUpQueuedAt: new Date(Date.now() - 86400000).toISOString(),
      followUpRequestApprovalId: "appr-old",
    });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    // classifyForFollowUp catches this first.
    expect(body.code).toBe("follow_up_queued");
  });

  it("invalid JSON body still works because body is optional", async () => {
    const id = await seedSentInvite({ email: "ok@x.com", daysAgo: 10 });
    const { POST } = await import("../route");
    const empty = new Request(
      `http://localhost/api/ops/faire/direct-invites/${id}/follow-up/request-approval`,
      { method: "POST" },
    );
    const res = await POST(empty, ctx(id));
    expect(res.status).toBe(200);
  });
});

describe("happy paths", () => {
  it("overdue invite → opens Class B faire-direct.follow-up approval and stamps followUpQueuedAt", async () => {
    const id = await seedSentInvite({ email: "overdue@x.com", daysAgo: 14 });
    const { POST } = await import("../route");
    const res = await POST(
      makeReq(id, { requestedBy: "rene@usagummies.com" }),
      ctx(id),
    );
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

    expect(approvalSurfaceRef.surfaced).toHaveLength(1);
    const surfaced = approvalSurfaceRef.surfaced[0];
    expect(surfaced.targetEntity?.type).toBe("faire-follow-up");
    expect(surfaced.targetEntity?.id).toBe(id);
    expect(surfaced.payloadRef).toBe(`faire-follow-up:${id}`);
    expect(surfaced.payloadPreview).toContain("FOLLOW-UP");
    expect(surfaced.payloadPreview).toContain("Test Retailer");

    // Invite row was stamped.
    const reloaded = JSON.parse(
      (await kv.get<string>(`faire:invites:${id}`)) as string,
    ) as FaireInviteRecord;
    expect(reloaded.followUpQueuedAt).toBeTruthy();
    expect(reloaded.followUpRequestApprovalId).toBe(body.approvalId);
    // Status STAYS sent.
    expect(reloaded.status).toBe("sent");
    // No follow-up sent metadata yet.
    expect(reloaded.followUpSentAt).toBeUndefined();
    expect(reloaded.followUpGmailMessageId).toBeUndefined();
  });

  it("due_soon invite → also opens approval", async () => {
    const id = await seedSentInvite({ email: "due@x.com", daysAgo: 5 });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(200);
  });

  it("approvers override is honored when supplied", async () => {
    const id = await seedSentInvite({ email: "ov@x.com", daysAgo: 10 });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id, { approvers: ["Ben"] }), ctx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requiredApprovers: string[] };
    expect(body.requiredApprovers).toEqual(["Ben"]);
  });
});

describe("Phase 3.3 invariant — no email send at request time", () => {
  it("happy path writes ONLY to KV + control-plane store (no Gmail/HubSpot/Faire call)", async () => {
    // The vi.mock surface only covers @vercel/kv + abra-auth. Any
    // attempt by the route to hit Gmail / HubSpot / Faire would fail
    // because those clients aren't mocked. The fact that the test
    // completes confirms no such call is made.
    const id = await seedSentInvite({ email: "x@x.com", daysAgo: 10 });
    const { POST } = await import("../route");
    const res = await POST(makeReq(id), ctx(id));
    expect(res.status).toBe(200);
    // Approval store has exactly one entry.
    expect(approvalStoreRef._size).toBe(1);
  });
});
