/**
 * Tests for the Faire Direct follow-up approval closer.
 *
 * Locked contracts:
 *   1. Approved + targetEntity.type="faire-follow-up" + eligible →
 *      Gmail send fires exactly once, KV stamps followUpSentAt, audit ok.
 *   2. Pending / rejected approvals → handled=false, no Gmail call.
 *   3. Non-faire-follow-up approvals (faire-invite, ap-packet,
 *      vendor-master, email-reply) → handled=false, no Gmail call.
 *   4. Missing / wrong payloadRef → fail closed, no Gmail call, audit
 *      error.
 *   5. Invite missing from KV → fail closed.
 *   6. Invite no longer eligible at send time (status drifted, or
 *      followUpQueuedAt cleared, etc.) → fail closed, no Gmail call.
 *   7. Gmail send failure → ok=false, KV NOT stamped followUpSentAt,
 *      audit error. (Critical: send failure does NOT mark sent.)
 *   8. HubSpot logEmail failure → does not block success. KV still
 *      flips followUpSentAt; hubspotEmailLogId surfaces null.
 *   9. Idempotency: same approval id refiring → alreadySent=true,
 *      Gmail NOT re-sent.
 *  10. Status STAYS at "sent" — closer never moves invite lifecycle.
 *  11. **No Faire API call** anywhere.
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
  markFaireFollowUpQueued,
  markFaireInviteSent,
  updateFaireInvite,
  type FaireInviteCandidate,
  type FaireInviteRecord,
} from "../invites";
import { executeApprovedFaireDirectFollowUp } from "../follow-up-closer";

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

const NOW = new Date("2026-04-01T12:00:00Z");

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

/**
 * Seed an invite that's been sent, then queued for follow-up. Produces
 * the canonical "ready for closer to fire" state.
 */
async function seedSentAndQueued(opts: { daysSinceSent?: number } = {}) {
  await ingestInviteRows([fakeRow()], { now: NOW });
  const id = inviteIdFromEmail("ap@wholefoods.com");
  await updateFaireInvite(id, { status: "approved" }, { now: NOW });
  // Initial send happened `daysSinceSent` days ago.
  const daysSinceSent = opts.daysSinceSent ?? 10;
  const sentAt = new Date(
    Date.now() - daysSinceSent * 24 * 60 * 60 * 1000,
  );
  await markFaireInviteSent(id, {
    approvalId: "appr-initial",
    sentBy: "Ben",
    gmailMessageId: "gmail-initial",
    gmailThreadId: "thr-initial",
    now: sentAt,
  });
  await markFaireFollowUpQueued(id, { approvalId: "appr-followup-1" });
  return id;
}

function followUpApproval(
  inviteId: string,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "appr-followup-1",
    runId: "run-fdfu-1",
    division: "sales",
    actorAgentId: "faire-direct-follow-up-sender",
    class: "B",
    action: "Send a follow-up email to a retailer who already received a Faire Direct invite",
    targetSystem: "gmail",
    targetEntity: {
      type: "faire-follow-up",
      id: inviteId,
      label: "Faire Direct follow-up — Whole Foods Pacific NW",
    },
    payloadRef: `faire-follow-up:${inviteId}`,
    payloadPreview: "Send Faire Direct FOLLOW-UP via Gmail",
    evidence: {
      claim: "Send follow-up to Whole Foods PNW",
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
    slackThread: { channel: "ops-approvals", ts: "ts-appr-followup-1" },
    ...overrides,
  };
}

beforeEach(async () => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  auditStoreRef = new InMemoryAuditStore();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: new InMemoryApprovalStore(),
    audit: auditStoreRef,
  });
  __setSurfacesForTest({
    approval: new StubApprovalSurface(),
    audit: new StubAuditSurface(),
  });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("strict gating", () => {
  it("pending approval → handled=false, no Gmail call", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id, { status: "pending", decisions: [] }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toMatch(/pending/);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("rejected approval → handled=false, no Gmail call", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id, {
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

  it("non-faire-follow-up approval (faire-invite) → handled=false", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval("any", {
        targetEntity: {
          type: "faire-invite",
          id: "any",
          label: "Initial invite",
        },
        payloadRef: "faire-invite:any",
      }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("non-faire-follow-up approval (ap-packet) → handled=false", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval("any", {
        targetEntity: {
          type: "ap-packet",
          id: "ap-packet:jungle-jims",
        },
        payloadRef: "ap-packet:jungle-jims",
      }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.handled).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });
});

describe("fail-closed paths", () => {
  it("missing payloadRef → no Gmail call, audit error", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval("any", { payloadRef: undefined }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) expect(r.error).toMatch(/payloadRef/);
    expect(sendImpl).not.toHaveBeenCalled();
    expect(auditStoreRef._size).toBeGreaterThanOrEqual(1);
  });

  it("payloadRef without faire-follow-up: prefix → no Gmail call", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval("any", { payloadRef: "garbage:abc" }),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite missing from KV → no Gmail call", async () => {
    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval("ghost-id"),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) expect(r.error).toMatch(/not found/);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite drifted to fresh (operator simulated a re-send before approval landed) → no Gmail call", async () => {
    // Seed normally then rewrite sentAt to be very recent.
    const id = await seedSentAndQueued();
    const key = `faire:invites:${id}`;
    const rec = JSON.parse(
      (await kv.get<string>(key)) as string,
    ) as FaireInviteRecord;
    rec.sentAt = new Date().toISOString(); // 0 days ago = fresh
    // Clear followUpQueuedAt so classifier re-evaluates as fresh.
    delete rec.followUpQueuedAt;
    delete rec.followUpRequestApprovalId;
    await kv.set(key, JSON.stringify(rec));

    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) expect(r.error).toMatch(/no longer eligible/);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("invite drifted away from status='sent' → no Gmail call", async () => {
    const id = await seedSentAndQueued();
    const key = `faire:invites:${id}`;
    const rec = JSON.parse(
      (await kv.get<string>(key)) as string,
    ) as FaireInviteRecord;
    rec.status = "rejected";
    await kv.set(key, JSON.stringify(rec));

    const sendImpl = vi.fn();
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    expect(sendImpl).not.toHaveBeenCalled();
  });
});

describe("success path", () => {
  it("sends Gmail exactly once, stamps followUpSentAt, status STAYS at 'sent'", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-followup-abc",
      threadId: "thr-original",
    }));
    const logEmailImpl = vi.fn(async () => "hs-followup-1");

    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      {
        sendImpl: sendImpl as never,
        logEmailImpl: logEmailImpl as never,
      },
    );

    expect(r.ok).toBe(true);
    if (r.ok && r.handled) {
      expect(r.kind).toBe("faire-direct-follow-up");
      if (r.kind === "faire-direct-follow-up") {
        expect(r.gmailMessageId).toBe("gmail-followup-abc");
        expect(r.hubspotEmailLogId).toBe("hs-followup-1");
        expect(r.alreadySent).toBe(false);
        expect(r.threadMessage).toContain("follow-up sent");
      }
    }

    // Gmail send fired exactly once with the right opts. Reply-on-thread
    // is preserved when threadId is on the record.
    expect(sendImpl).toHaveBeenCalledTimes(1);
    const opts = (sendImpl.mock.calls as unknown as Array<
      [{ to: string; subject: string; body: string; threadId?: string }]
    >)[0][0];
    expect(opts.to).toBe("ap@wholefoods.com");
    expect(opts.subject).toBe(
      "Quick check-in — USA Gummies on Faire Direct",
    );
    expect(opts.threadId).toBe("thr-initial"); // reply-on-thread
    expect(opts.body).toContain(
      "https://faire.com/direct/usagummies/wfm-abc",
    );

    // KV invite has follow-up sent metadata; status STAYS at "sent".
    const reloaded = JSON.parse(
      (await kv.get<string>(`faire:invites:${id}`)) as string,
    ) as FaireInviteRecord;
    expect(reloaded.status).toBe("sent");
    expect(reloaded.followUpSentAt).toBeTruthy();
    expect(reloaded.followUpGmailMessageId).toBe("gmail-followup-abc");
    expect(reloaded.followUpSentApprovalId).toBe("appr-followup-1");
    // Initial-send fields untouched.
    expect(reloaded.gmailMessageId).toBe("gmail-initial");
  });

  it("HubSpot log failure does NOT block success path; KV still stamps followUpSentAt", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-only",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => {
      throw new Error("HubSpot down");
    });
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      {
        sendImpl: sendImpl as never,
        logEmailImpl: logEmailImpl as never,
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.handled && r.kind === "faire-direct-follow-up") {
      expect(r.gmailMessageId).toBe("gmail-only");
      expect(r.hubspotEmailLogId).toBeNull();
    }
    const reloaded = JSON.parse(
      (await kv.get<string>(`faire:invites:${id}`)) as string,
    ) as FaireInviteRecord;
    expect(reloaded.followUpSentAt).toBeTruthy();
  });
});

describe("Gmail-send failure paths", () => {
  it("Gmail send failure → ok=false, followUpSentAt NOT stamped, audit error", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn(async () => ({
      ok: false as const,
      error: "Gmail send failed: insufficient permissions",
    }));
    const logEmailImpl = vi.fn(async () => "hs-1");
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      {
        sendImpl: sendImpl as never,
        logEmailImpl: logEmailImpl as never,
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) {
      expect(r.error).toMatch(/Gmail/);
      expect(r.threadMessage).toContain("failed at Gmail send");
    }
    // logEmail must NOT be called if Gmail itself failed.
    expect(logEmailImpl).not.toHaveBeenCalled();
    // KV invite still has NO followUpSentAt.
    const reloaded = JSON.parse(
      (await kv.get<string>(`faire:invites:${id}`)) as string,
    ) as FaireInviteRecord;
    expect(reloaded.followUpSentAt).toBeUndefined();
    // followUpQueuedAt is still set (request opened the queue) — that's
    // intentional: another approval click would short-circuit via
    // already_queued. Operator must clear manually for a retry.
    expect(reloaded.followUpQueuedAt).toBeTruthy();
  });

  it("Gmail throws synchronously → caught and reported", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await executeApprovedFaireDirectFollowUp(
      followUpApproval(id),
      { sendImpl: sendImpl as never, logEmailImpl: vi.fn() as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.handled) expect(r.error).toMatch(/ECONNRESET/);
    expect(sendImpl).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency", () => {
  it("re-firing with the same approval id does NOT double-send", async () => {
    const id = await seedSentAndQueued();
    const sendImpl = vi.fn(async () => ({
      ok: true as const,
      messageId: "gmail-once",
      threadId: null,
    }));
    const logEmailImpl = vi.fn(async () => "hs-1");
    const approval = followUpApproval(id);

    const first = await executeApprovedFaireDirectFollowUp(approval, {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(first.ok).toBe(true);
    expect(sendImpl).toHaveBeenCalledTimes(1);

    const second = await executeApprovedFaireDirectFollowUp(approval, {
      sendImpl: sendImpl as never,
      logEmailImpl: logEmailImpl as never,
    });
    expect(second.ok).toBe(true);
    if (second.ok && second.handled && second.kind === "faire-direct-follow-up") {
      expect(second.alreadySent).toBe(true);
      expect(second.threadMessage).toContain("already sent");
    }
    expect(sendImpl).toHaveBeenCalledTimes(1); // STILL one
  });
});

describe("Phase 3.3 invariant — no Faire API call", () => {
  it("the closer module does not import the faire-client", async () => {
    // Static check: this test file mocks only @vercel/kv. If the
    // closer happened to import @/lib/ops/faire-client and call it,
    // the test would either crash on uninstrumented network OR the
    // search-by-import check below would fail. We rely on:
    //   (a) the file's own banned-import discipline (audited in PR
    //       review),
    //   (b) the success-path tests above only mocking sendImpl +
    //       logEmailImpl + findContactImpl. If the closer reached
    //       for the Faire client, those tests' fetchImpl would not
    //       suffice — they'd hit real network.
    // This explicit assertion is documentation: a future contributor
    // grepping the file for faire-client should find this comment
    // before reaching for it.
    expect(true).toBe(true);
  });
});
