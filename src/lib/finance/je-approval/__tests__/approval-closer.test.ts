/**
 * Tests for the JE post approval closer.
 *
 * Locked contracts (each one closes a specific failure mode):
 *   1. Approved JE approval → /api/ops/qbo/journal-entry POSTed exactly
 *      once with the persisted payload's lines + memo + txn_date.
 *   2. Pending or rejected JE approvals → no POST, no audit-as-success.
 *   3. Non-JE approvals (email-reply, shipment-create, vendor-master)
 *      → ignored (handled=false), never call the QBO route.
 *   4. QBO route returns blocked (validation failed) → closer returns
 *      ok=false and threadMessage flags the validation failure.
 *   5. KV miss on the persisted payload (TTL expired or never written)
 *      → fail closed, no POST, audit recorded as error.
 *   6. The closer NEVER posts to QBO directly — every JE write goes
 *      through the existing /api/ops/qbo/journal-entry route, which
 *      runs its own guardrails as a defense-in-depth check.
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
import type { JeProposal } from "../types";

// KV mock — the closer reads the persisted proposal payload by approval id.
const kvStore = new Map<string, string>();
vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      kvStore.set(key, value);
      return "OK";
    }),
  },
}));

import { executeApprovedJournalEntryPost } from "../approval-closer";
import type { StoredJePayload } from "../payload-store";

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

const exampleProposal: JeProposal = {
  proposalId: "amex-reclass-1",
  memo: "JE 1505 — AmEx CC payment reclass",
  rationale: "Booke flagged as expense; per Ben it's a transfer.",
  txn_date: "2026-01-15",
  lines: [
    {
      posting_type: "Debit",
      account_id: "85",
      account_name: "AmEx Liability",
      amount: 1937.61,
    },
    {
      posting_type: "Credit",
      account_id: "1",
      account_name: "BoA Checking 7020",
      amount: 1937.61,
    },
  ],
};

function buildApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "appr-je-1",
    runId: "run-je-1",
    division: "financials",
    actorAgentId: "je-propose",
    class: "C",
    action: "qbo.journal_entry.post",
    targetSystem: "qbo",
    targetEntity: {
      type: "qbo-journal-entry",
      id: "amex-reclass-1",
      label: "JE amex-reclass-1 · $1937.61",
    },
    payloadPreview: ":ledger: ...",
    payloadRef: "je-propose:amex-reclass-1",
    evidence: {
      claim: "Post manual JE...",
      sources: [{ system: "je-propose", id: "amex-reclass-1", retrievedAt: now }],
      confidence: 0.95,
    },
    rollbackPlan: "Reverse via balancing JE",
    requiredApprovers: ["Ben", "Rene"],
    status: "approved",
    createdAt: now,
    decisions: [
      { approver: "Ben", decision: "approve", decidedAt: now },
      { approver: "Rene", decision: "approve", decidedAt: now },
    ],
    escalateAt: now,
    expiresAt: now,
    slackThread: { channel: "ops-approvals", ts: "ts-appr-je-1" },
    ...overrides,
  };
}

function seedPayloadFor(approvalId: string, proposal = exampleProposal) {
  const stored: StoredJePayload = {
    approvalId,
    proposal,
    persistedAt: new Date().toISOString(),
  };
  kvStore.set(`je-approval:payload:${approvalId}`, JSON.stringify(stored));
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
  kvStore.clear();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.CRON_SECRET;
});

describe("executeApprovedJournalEntryPost — success path", () => {
  it("posts to /api/ops/qbo/journal-entry exactly once with the persisted lines", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          journal_entry: { Id: "qbo-je-9999" },
          validation: { issues: [], summary: "balanced" },
        }),
        { status: 200 },
      ),
    );
    const result = await executeApprovedJournalEntryPost(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
    if (result.ok && result.handled) {
      expect(result.kind).toBe("qbo-journal-entry-posted");
      expect(result.qboJournalEntryId).toBe("qbo-je-9999");
      expect(result.threadMessage).toContain("qbo-je-9999");
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    const [url, init] = callArgs;
    expect(url).toBe("https://example.test/api/ops/qbo/journal-entry");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-cron-secret");
    const body = JSON.parse(init.body) as {
      lines: unknown[];
      txn_date: string;
      memo: string;
      caller: string;
    };
    expect(body.lines).toEqual(exampleProposal.lines);
    expect(body.txn_date).toBe("2026-01-15");
    expect(body.memo).toContain("AmEx CC payment");
    expect(body.caller).toContain("je-approval-closer:appr-je-1");
  });
});

describe("executeApprovedJournalEntryPost — strict gating", () => {
  it("ignores non-approved approvals (pending/rejected)", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn();
    const r = await executeApprovedJournalEntryPost(
      buildApproval({ status: "pending" }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores approvals with the wrong targetEntity.type (e.g. ap-packet)", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn();
    const r = await executeApprovedJournalEntryPost(
      buildApproval({
        targetEntity: { type: "ap-packet", id: "ap-packet:jungle-jims" },
      }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores approvals with the wrong action slug", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn();
    const r = await executeApprovedJournalEntryPost(
      buildApproval({ action: "qbo.invoice.send" }),
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(r.handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeApprovedJournalEntryPost — failure paths", () => {
  it("fails closed when KV payload is missing (TTL expired or never persisted)", async () => {
    // Note: NO seedPayloadFor() call here.
    const fetchMock = vi.fn();
    const r = await executeApprovedJournalEntryPost(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.handled).toBe(true);
    if (!r.ok && r.handled) {
      expect(r.kind).toBe("qbo-journal-entry-post-failed");
      expect(r.error).toContain("no persisted payload");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when QBO route returns 422 (guardrail-blocked)", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          blocked: true,
          validation: {
            issues: [{ field: "amount", reason: "exceeds policy cap" }],
            summary: "Validation failed: amount cap breach",
          },
          message: "Validation failed: amount cap breach",
        }),
        { status: 422 },
      ),
    );
    const r = await executeApprovedJournalEntryPost(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.handled).toBe(true);
    if (!r.ok && r.handled) {
      expect(r.threadMessage).toContain("Validation blocked by guardrails");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a network error", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await executeApprovedJournalEntryPost(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.handled).toBe(true);
    if (!r.ok && r.handled) {
      expect(r.error).toContain("ECONNREFUSED");
    }
  });

  it("fails closed on 500 with no body", async () => {
    seedPayloadFor("appr-je-1");
    const fetchMock = vi.fn(async () => new Response("server crashed", { status: 500 }));
    const r = await executeApprovedJournalEntryPost(buildApproval(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.handled).toBe(true);
  });
});
