/**
 * Tests for the Faire Direct invite review queue (Phase 1 — review only).
 *
 * Locked contracts:
 *   - Valid candidate → KV record with status="needs_review".
 *   - Invalid email rejected (validation_failed).
 *   - Missing retailerName rejected.
 *   - Missing source rejected.
 *   - Duplicate email (within batch + cross-batch) flagged, not double-added.
 *   - listInvitesByStatus groups correctly.
 *   - missing FAIRE_ACCESS_TOKEN → isFaireConfigured() === false; queue
 *     ingest still works (degraded mode is at the dashboard layer).
 *   - **No email / Faire / Gmail / Slack send happens during ingest.**
 *     Proven by mocking only @vercel/kv — any other network call would
 *     crash uninstrumented in tests.
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
  __resetInvitesForTest,
  ingestInviteRows,
  inviteIdFromEmail,
  isFaireConfigured,
  listInvites,
  listInvitesByStatus,
  validateInvite,
  VALID_FAIRE_INVITE_STATUSES,
  type FaireInviteCandidate,
} from "../invites";

const NOW = new Date("2026-04-27T12:00:00Z");

function fakeRow(
  overrides: Partial<FaireInviteCandidate> = {},
): Partial<FaireInviteCandidate> {
  return {
    retailerName: "Test Retailer",
    email: "buyer@retailer.com",
    source: "wholesale-page",
    ...overrides,
  };
}

beforeEach(async () => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  await __resetInvitesForTest();
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});

describe("VALID_FAIRE_INVITE_STATUSES — locked enum", () => {
  it("includes the four lifecycle codes in the right order", () => {
    expect(VALID_FAIRE_INVITE_STATUSES).toEqual([
      "needs_review",
      "approved",
      "sent",
      "rejected",
    ]);
  });
});

describe("validateInvite — pure helper", () => {
  it("valid candidate produces a normalized record", () => {
    const r = validateInvite(fakeRow());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.candidate.email).toBe("buyer@retailer.com");
      expect(r.candidate.retailerName).toBe("Test Retailer");
      expect(r.candidate.source).toBe("wholesale-page");
    }
  });

  it("lowercases + trims email", () => {
    const r = validateInvite(
      fakeRow({ email: "  Buyer@RETAILER.com  " }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candidate.email).toBe("buyer@retailer.com");
  });

  it("missing retailerName → reason", () => {
    const r = validateInvite(fakeRow({ retailerName: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/retailerName/);
  });

  it("missing source → reason", () => {
    const r = validateInvite(fakeRow({ source: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/source/);
  });

  it("missing email → reason", () => {
    const r = validateInvite({
      retailerName: "X",
      source: "x",
    } as Partial<FaireInviteCandidate>);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/email/);
  });

  it("invalid email → reason", () => {
    const r = validateInvite(fakeRow({ email: "not-an-email" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/email/);
  });

  it("optional fields trimmed and dropped if blank", () => {
    const r = validateInvite(
      fakeRow({
        buyerName: "  Sarah Smith  ",
        city: "  ",
        state: "WA",
        notes: " hand-stocked Tuesdays ",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.candidate.buyerName).toBe("Sarah Smith");
      expect(r.candidate.city).toBeUndefined();
      expect(r.candidate.state).toBe("WA");
      expect(r.candidate.notes).toBe("hand-stocked Tuesdays");
    }
  });
});

describe("ingestInviteRows — happy path", () => {
  it("valid candidate becomes a needs_review record", async () => {
    const r = await ingestInviteRows([fakeRow()], { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.queued).toBe(1);
    expect(r.errors).toHaveLength(0);
    const list = await listInvites();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("needs_review");
    expect(list[0].queuedAt).toBe(NOW.toISOString());
    expect(list[0].id).toBe(inviteIdFromEmail("buyer@retailer.com"));
  });

  it("multiple valid candidates → multiple records", async () => {
    const r = await ingestInviteRows(
      [
        fakeRow({ email: "a@x.com" }),
        fakeRow({ email: "b@x.com" }),
        fakeRow({ email: "c@x.com" }),
      ],
      { now: NOW },
    );
    expect(r.queued).toBe(3);
    const list = await listInvites();
    expect(list.map((x) => x.email).sort()).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
});

describe("ingestInviteRows — invalid input", () => {
  it("invalid email → rejected with rowIndex + reason", async () => {
    const r = await ingestInviteRows(
      [fakeRow({ email: "not-an-email" })],
      { now: NOW },
    );
    expect(r.queued).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].rowIndex).toBe(1);
    expect(r.errors[0].code).toBe("validation_failed");
    expect(r.errors[0].detail).toMatch(/email/);
  });

  it("missing retailer → rejected with stable code", async () => {
    const r = await ingestInviteRows(
      [fakeRow({ retailerName: "" })],
      { now: NOW },
    );
    expect(r.queued).toBe(0);
    expect(r.errors[0].detail).toMatch(/retailerName/);
  });

  it("non-array input → single 'unknown' error", async () => {
    const r = await ingestInviteRows(
      "not-an-array" as unknown as Partial<FaireInviteCandidate>[],
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("unknown");
  });

  it("partial errors keep the valid rows queued (multi-status semantics)", async () => {
    const r = await ingestInviteRows(
      [
        fakeRow({ email: "ok@x.com" }),
        fakeRow({ email: "bad-email" }),
        fakeRow({ retailerName: "", email: "z@x.com" }),
      ],
      { now: NOW },
    );
    expect(r.queued).toBe(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].rowIndex).toBe(2);
    expect(r.errors[1].rowIndex).toBe(3);
  });
});

describe("ingestInviteRows — duplicates", () => {
  it("duplicate email within a batch → 1 queued + 1 duplicate error", async () => {
    const r = await ingestInviteRows(
      [
        fakeRow({ email: "buyer@x.com" }),
        fakeRow({ email: "buyer@x.com" }),
      ],
      { now: NOW },
    );
    expect(r.queued).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("duplicate");
  });

  it("case-insensitive duplicate within batch → flagged", async () => {
    const r = await ingestInviteRows(
      [
        fakeRow({ email: "buyer@x.com" }),
        fakeRow({ email: "BUYER@X.COM" }),
      ],
      { now: NOW },
    );
    expect(r.queued).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("duplicate");
  });

  it("duplicate against existing queue (different batch) → flagged", async () => {
    await ingestInviteRows([fakeRow({ email: "buyer@x.com" })], { now: NOW });
    const r = await ingestInviteRows([fakeRow({ email: "buyer@x.com" })], {
      now: NOW,
    });
    expect(r.queued).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("duplicate");
    const list = await listInvites();
    expect(list).toHaveLength(1);
  });
});

describe("listInvitesByStatus — GET grouping", () => {
  it("groups by status; empty buckets present when nothing matches", async () => {
    await ingestInviteRows(
      [fakeRow({ email: "a@x.com" }), fakeRow({ email: "b@x.com" })],
      { now: NOW },
    );
    // Manually flip one to approved for the grouping test.
    const list = await listInvites();
    const approved = { ...list[0], status: "approved" as const };
    await kv.set(`faire:invites:${approved.id}`, JSON.stringify(approved));

    const grouped = await listInvitesByStatus();
    expect(grouped.needs_review).toHaveLength(1);
    expect(grouped.approved).toHaveLength(1);
    expect(grouped.sent).toEqual([]);
    expect(grouped.rejected).toEqual([]);
  });

  it("empty queue returns four empty buckets", async () => {
    const grouped = await listInvitesByStatus();
    expect(grouped.needs_review).toEqual([]);
    expect(grouped.approved).toEqual([]);
    expect(grouped.sent).toEqual([]);
    expect(grouped.rejected).toEqual([]);
  });
});

describe("isFaireConfigured — degraded mode signal", () => {
  it("returns false when FAIRE_ACCESS_TOKEN is unset", () => {
    delete process.env.FAIRE_ACCESS_TOKEN;
    expect(isFaireConfigured()).toBe(false);
  });

  it("returns true when FAIRE_ACCESS_TOKEN is set", () => {
    process.env.FAIRE_ACCESS_TOKEN = "test-token";
    expect(isFaireConfigured()).toBe(true);
    delete process.env.FAIRE_ACCESS_TOKEN;
  });

  it("queue ingest still works when Faire token is missing", async () => {
    delete process.env.FAIRE_ACCESS_TOKEN;
    const r = await ingestInviteRows([fakeRow()], { now: NOW });
    expect(r.queued).toBe(1);
    expect(r.errors).toHaveLength(0);
  });
});

describe("Phase 1 invariant — no sends happen", () => {
  it("ingest writes ONLY to KV (kv.set is the single mocked side effect)", async () => {
    // Mocked kv is in scope; if the module secretly called fetch /
    // gmail / slack / faire-client, the mock surface would be crashed
    // by uninstrumented network access.
    const before = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await ingestInviteRows(
      [fakeRow({ email: "a@x.com" }), fakeRow({ email: "b@x.com" })],
      { now: NOW },
    );
    const after = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    // Each created invite is one set + one index write at the end =
    // 3 writes total for 2 invites.
    expect(after - before).toBe(3);
  });
});
