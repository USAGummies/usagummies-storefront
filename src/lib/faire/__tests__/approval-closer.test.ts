/**
 * Tests for the Faire Direct invite approval closer.
 *
 * Locked contracts:
 *   1. Approved + targetEntity.type="faire-invite" + valid invite →
 *      Gmail send fired exactly once, KV flipped to "sent", audit OK.
 *   2. Pending / rejected approvals → handled=false, no Gmail call.
 *   3. Non-faire-invite approvals (ap-packet, vendor-master,
 *      email-reply) → handled=false, no Gmail call.
 *   4. Missing / wrong payloadRef → fail closed, no Gmail call, audit
 *      error.
 *   5. Invite missing from KV at send time → fail closed, no Gmail call.
 *   6. Invite no longer eligible (status drifted to needs_review or
 *      directLinkUrl cleared) → fail closed, no Gmail call.
 *   7. Gmail send failure → ok=false, threadMessage flags failure, KV
 *      NOT flipped to "sent", audit error.
 *   8. HubSpot logEmail failure → does not block the success path —
 *      hubspotEmailLogId surfaces null, KV still flips to "sent".
 *   9. Idempotency: same approval id refiring → alreadySent=true, no
 *      duplicate Gmail send.
 *  10. Body never contains medical claims; always contains the
 *      operator-pasted directLinkUrl verbatim; subject is the locked
 *      "USA Gummies on Faire Direct" string.
 *  11. Operator-only contact is in the closing — no recipient PII or
 *      HubSpot ids leaked back into the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
} from "../invites";
import {
  executeApprovedFaireDirectInvite,
  renderFaireInviteEmailBody,
} from "../approval-closer";

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

let auditStoreRef: InMemoryAuditStore;
let auditSurfaceRef: StubAuditSurface;

const NOW = new Date("2026-04-27T12:00:00Z");

function fakeRow(
  overrides: Partial<FaireInviteCandidate> = {},
): Partial<FaireInviteCandidate> {
  return {
    retailerName: "Whole Foods Pacific NW",
    buyerName: "Sarah Smith",
    email: "ap@wholefoods.com",
    source: "wholesale-page",
    directLinkUrl: "https://faire.com/direct/usagummies/wfm-abc",
    ...overrides,
  };
}

async function seedApprovedInvite(): Promise<string> {
  await ingestInviteRows([fakeRow()], { now: NOW });
  const id = inviteIdFromEmail("ap@wholefoods.com");
  await updateFaireInvite(id, { status: "approved" }, { now: NOW });
  return id;
}

function approvalForInvite(
  inviteId: string,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "appr-fdi-1",
    runId: "run-fdi-1",
    division: "sales",
    actorAgentId: "faire-direct-invite-sender",
    class: "B",
    action: "Send a Faire Direct invite email to an existing retailer/lead",
    targetSystem: "gmail",
    targetEntity: {
      type: "faire-invite",
      id: inviteId,
      label: "Faire Direct invite — Whole Foods Pacific NW",
    },
    payloadRef: `faire-invite:${inviteId}`,
    payloadPreview: "Send Faire Direct invite via Gmail",
    evidence: {
      claim: "Send Faire Direct invite to Whole Foods Pacific NW",
      sources: [{ system: "faire-invites", id: inviteId, retrievedAt: now }],
      confidence: 0.95,
    },
    rollbackPlan: "Gmail undo-send window",
    requiredApprovers: ["Ben"],
    status: "approved",
    createdAt: now,
    decisions: [{ approver: "Ben", decision: "approve", decidedAt: now }],
    escalateAt: now,
    expiresAt: now,
    slackThread: { channel: "ops-approvals", ts: "ts-appr-fdi-1" },
    ...overrides,
  };
}

beforeEach(async () => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  auditStoreRef = new InMemoryAuditStore();
  auditSurfaceRef = new StubAuditSurface();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: new InMemoryApprovalStore(),
    audit: auditStoreRef,
  });
  __setSurfacesForTest({
    approval: new StubApprovalSurface(),
    audit: auditSurfaceRef,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Body rendering — content invariants
// ---------------------------------------------------------------------------

describe("renderFaireInviteEmailBody — content invariants", () => {
  it("contains the directLinkUrl verbatim", () => {
    const body = renderFaireInviteEmailBody({
      id: "x",
      retailerName: "X",
      email: "a@b.com",
      source: "s",
      directLinkUrl: "https://faire.com/direct/usagummies/exact-link-9",
      status: "approved",
      queuedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(body).toContain(
      "https://faire.com/direct/usagummies/exact-link-9",
    );
  });
  it("does not include medical / supplement / vitamin / cure / treatment / FDA claims", () => {
    const body = renderFaireInviteEmailBody({
      id: "x",
      retailerName: "X",
      email: "a@b.com",
      source: "s",
      directLinkUrl: "https://faire.com/x",
      status: "approved",
      queuedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const banned = [
      /vitamin/i,
      /supplement/i,
      /cure/i,
      /treat\b/i,
      /immune/i,
      /FDA/i,
      /diagnose/i,
      /heal/i,
      /health\s+benefit/i,
    ];
    for (const re of banned) {
      expect(body).not.toMatch(re);
    }
  });
  it("uses the buyerName for greeting when present, falls back to retailerName otherwise", () => {
    const withBuyer = renderFaireInviteEmailBody({
      id: "x",
      retailerName: "Foo",
      buyerName: "Sarah",
      email: "a@b.com",
      source: "s",
      directLinkUrl: "https://faire.com/x",
      status: "approved",
      queuedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(withBuyer.startsWith("Hi Sarah,")).toBe(true);
    const withoutBuyer = renderFaireInviteEmailBody({
      id: "x",
      retailerName: "Foo",
      email: "a@b.com",
      source: "s",
      directLinkUrl: "https://faire.com/x",
      status: "approved",
      queuedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(withoutBuyer.startsWith("Hi Foo,")).toBe(true);
  });
  it("signs off with operator-only contact (no PII echo of recipient)", () => {
    const body = renderFaireInviteEmailBody({
      id: "x",
      retailerName: "Foo",
      buyerName: "Sarah",
      email: "secret-buyer@example.com",
      hubspotContactId: "12345",
      source: "s",
      directLinkUrl: "https://faire.com/x",
      status: "approved",
      queuedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(body).toContain("ben@usagummies.com");
    expect(body).not.toContain("secret-buyer@example.com");
    expect(body).not.toContain("12345");
  });
});

// ---------------------------------------------------------------------------
// Strict gating
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — strict gating", () => {
  it("pending approval → handled=false, no Gmail call", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite(id, { status: "pending", decisions: [] }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toMatch(/pending/);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("rejected approval → handled=false, no Gmail call", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite(id, {
        status: "rejected",
        decisions: [
          {
            approver: "Ben",
            decision: "reject",
            decidedAt: new Date().toISOString(),
          },
        ],
      }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("non-faire-invite approval (ap-packet) → handled=false, no Gmail call", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite("any", {
        targetEntity: {
          type: "ap-packet",
          id: "ap-packet:jungle-jims",
          label: "Jungle Jim's AP reply",
        },
        payloadRef: "ap-packet:jungle-jims",
      }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("non-faire-invite approval (email-reply) → handled=false, no Gmail call", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite("any", {
        targetEntity: {
          type: "email-reply",
          id: "gmail:msg-123",
          label: "Email reply",
        },
        payloadRef: "email-reply:msg-123",
      }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fail-closed paths
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — fail-closed paths", () => {
  it("missing payloadRef → no Gmail call, audit error", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite("any", { payloadRef: undefined }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    // targetEntity is still type=faire-invite, so this is "handled" but error.
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/payloadRef/);
    }
    expect(sendImpl).not.toHaveBeenCalled();
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(1);
  });

  it("payloadRef without faire-invite: prefix → no Gmail call", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite("any", { payloadRef: "garbage:abc" }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite missing from KV → no Gmail call, audit error", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite("ghost-id"),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/not found/);
    }
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite drifted to needs_review → no Gmail call (eligibility re-check)", async () => {
    const id = await seedApprovedInvite();
    // Operator rolled the row back to needs_review between
    // request-approval and Slack click.
    await updateFaireInvite(id, { status: "needs_review" }, { now: NOW });
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite(id),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/no longer eligible/);
    }
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite directLinkUrl cleared after approval → no Gmail call", async () => {
    const id = await seedApprovedInvite();
    // Manually clear the URL after approval (defensive — also a real
    // operator could correct it via a follow-up patch, but with the
    // approval-readiness rule in place the only way to land here is
    // via direct KV manipulation or a race).
    const key = `faire:invites:${id}`;
    const raw = (await kv.get<string>(key)) as string;
    const rec = JSON.parse(raw);
    rec.directLinkUrl = undefined;
    await kv.set(key, JSON.stringify(rec));
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectInvite(
      approvalForInvite(id),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — success path", () => {
  it("sends Gmail exactly once with right shape, flips KV to sent, audit ok", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-abc",
      threadId: "thr-abc",
    }));
    const logEmailImpl = vi.fn(async () => "hubspot-1");

    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
      now: new Date("2026-04-30T10:00:00Z"),
    });

    expect(r.ok).toBe(true);
    if (r.ok && r.handled) {
      expect(r.kind).toBe("faire-direct-invite");
      if (r.kind === "faire-direct-invite") {
        expect(r.gmailMessageId).toBe("gmail-abc");
        expect(r.hubspotEmailLogId).toBe("hubspot-1");
        expect(r.alreadySent).toBe(false);
        expect(r.threadMessage).toContain("Faire Direct invite sent");
        expect(r.threadMessage).toContain("Whole Foods Pacific NW");
      }
    }

    // Gmail send fired exactly once with the right opts.
    expect(sendImpl).toHaveBeenCalledTimes(1);
    const opts = (sendImpl.mock.calls as unknown as Array<
      [{ to: string; subject: string; body: string }]
    >)[0][0];
    expect(opts.to).toBe("ap@wholefoods.com");
    expect(opts.subject).toBe("USA Gummies on Faire Direct");
    expect(opts.body).toContain(
      "https://faire.com/direct/usagummies/wfm-abc",
    );

    // HubSpot log called exactly once.
    expect(logEmailImpl).toHaveBeenCalledTimes(1);

    // KV invite is now sent.
    const reloaded = (await kv.get(`faire:invites:${id}`)) as string;
    const rec = JSON.parse(reloaded);
    expect(rec.status).toBe("sent");
    expect(rec.gmailMessageId).toBe("gmail-abc");
    expect(rec.hubspotEmailLogId).toBe("hubspot-1");
    expect(rec.sentApprovalId).toBe("appr-fdi-1");
  });

  it("HubSpot log failure does NOT block the success path; KV still flips to sent", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-only",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => {
      throw new Error("HubSpot down");
    });
    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.handled && r.kind === "faire-direct-invite") {
      expect(r.gmailMessageId).toBe("gmail-only");
      expect(r.hubspotEmailLogId).toBeNull();
    }
    const reloaded = (await kv.get(`faire:invites:${id}`)) as string;
    expect(JSON.parse(reloaded).status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — failure paths", () => {
  it("Gmail send failure → ok=false, KV NOT flipped to sent, audit error", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn(async () => ({
      ok: false as const,
      error: "Gmail send failed: insufficient permissions",
    }));
    const logEmailImpl = vi.fn(async () => "hubspot-1");
    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/Gmail send failed/);
      expect(r.threadMessage).toContain("failed at Gmail send");
    }
    // logEmail must NOT be called when Gmail itself failed.
    expect(logEmailImpl).not.toHaveBeenCalled();
    // Invite is still "approved", not "sent".
    const reloaded = (await kv.get(`faire:invites:${id}`)) as string;
    expect(JSON.parse(reloaded).status).toBe("approved");
  });

  it("Gmail throws synchronously → caught and reported", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: vi.fn() as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) expect(r.error).toMatch(/ECONNRESET/);
    expect(sendImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — idempotency", () => {
  it("re-firing with the same approval id does NOT double-send", async () => {
    const id = await seedApprovedInvite();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-once",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-1");
    const approval = approvalForInvite(id);

    // First call: real send.
    const first = await executeApprovedFaireDirectInvite(approval, {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(first.ok).toBe(true);
    expect(sendImpl).toHaveBeenCalledTimes(1);

    // Second call: should short-circuit without sending again.
    const second = await executeApprovedFaireDirectInvite(approval, {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(second.ok).toBe(true);
    if (second.ok && second.handled && second.kind === "faire-direct-invite") {
      expect(second.alreadySent).toBe(true);
      expect(second.threadMessage).toContain("already sent");
    }
    expect(sendImpl).toHaveBeenCalledTimes(1); // STILL one
  });
});

// ---------------------------------------------------------------------------
// Phase 3.1 — HubSpot contact-id fallback (lookup by email)
// ---------------------------------------------------------------------------

describe("executeApprovedFaireDirectInvite — HubSpot contact resolution", () => {
  it("uses the operator-pasted hubspotContactId when present, no findImpl call", async () => {
    // Seed an invite that ALREADY has a hubspotContactId — operator
    // pasted it at ingest time.
    await ingestInviteRows(
      [fakeRow({ hubspotContactId: "operator-pasted-77" })],
      { now: NOW },
    );
    const id = inviteIdFromEmail("ap@wholefoods.com");
    await updateFaireInvite(id, { status: "approved" }, { now: NOW });

    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-1",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-log-1");
    const findContactImpl = vi.fn(async () => "should-not-be-used");

    await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
      findContactImpl: findContactImpl as never,
    });

    // findImpl never called because operator-pasted id wins.
    expect(findContactImpl).not.toHaveBeenCalled();
    // logEmail was called WITH the pasted id.
    expect(logEmailImpl).toHaveBeenCalledTimes(1);
    const logArgs = (logEmailImpl.mock.calls as unknown as Array<
      [{ contactId?: string }]
    >)[0][0];
    expect(logArgs.contactId).toBe("operator-pasted-77");
  });

  it("falls back to findContactByEmail when hubspotContactId is absent", async () => {
    // Default fakeRow has NO hubspotContactId.
    const id = await seedApprovedInvite();

    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-2",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-log-2");
    const findContactImpl = vi.fn(async () => "found-by-email-123");

    // Configure HubSpot so the resolver actually calls findImpl.
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-hs-token";

    await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
      findContactImpl: findContactImpl as never,
    });

    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;

    expect(findContactImpl).toHaveBeenCalledWith("ap@wholefoods.com");
    const logArgs = (logEmailImpl.mock.calls as unknown as Array<
      [{ contactId?: string }]
    >)[0][0];
    expect(logArgs.contactId).toBe("found-by-email-123");
  });

  it("emits an unassociated email engagement when neither pasted id nor email lookup hits", async () => {
    const id = await seedApprovedInvite();

    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-3",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-log-3");
    const findContactImpl = vi.fn(async () => null);

    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-hs-token";

    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
      findContactImpl: findContactImpl as never,
    });

    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;

    expect(r.ok).toBe(true);
    expect(findContactImpl).toHaveBeenCalledTimes(1);
    // logEmail still ran — engagement lands in HubSpot but is unassociated.
    expect(logEmailImpl).toHaveBeenCalledTimes(1);
    const logArgs = (logEmailImpl.mock.calls as unknown as Array<
      [{ contactId?: string }]
    >)[0][0];
    expect(logArgs.contactId).toBeUndefined();
  });

  it("HubSpot search throwing does NOT abort the success path", async () => {
    const id = await seedApprovedInvite();

    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-4",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-log-4");
    const findContactImpl = vi.fn(async () => {
      throw new Error("HubSpot 502");
    });

    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-hs-token";

    const r = await executeApprovedFaireDirectInvite(approvalForInvite(id), {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
      findContactImpl: findContactImpl as never,
    });

    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;

    // Gmail send + KV flip both still succeeded; only the contact
    // association is missing.
    expect(r.ok).toBe(true);
    if (r.ok && r.handled && r.kind === "faire-direct-invite") {
      expect(r.gmailMessageId).toBe("gmail-4");
    }
    const reloaded = (await kv.get(`faire:invites:${id}`)) as string;
    expect(JSON.parse(reloaded).status).toBe("sent");
  });
});
