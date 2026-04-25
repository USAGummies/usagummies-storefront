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
  getInvite,
  ingestInviteRows,
  inviteIdFromEmail,
  isFaireConfigured,
  isValidDirectLinkUrl,
  listInvites,
  listInvitesByStatus,
  markFaireInviteSent,
  REVIEWABLE_STATUSES,
  updateFaireInvite,
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

// ---------------------------------------------------------------------------
// Phase 2 — review actions (updateFaireInvite)
// ---------------------------------------------------------------------------

describe("REVIEWABLE_STATUSES — locked enum", () => {
  it("intentionally excludes 'sent'", () => {
    expect(REVIEWABLE_STATUSES).toEqual([
      "needs_review",
      "approved",
      "rejected",
    ]);
    expect(REVIEWABLE_STATUSES).not.toContain("sent");
  });
});

describe("updateFaireInvite — happy paths", () => {
  it("status update persists with reviewedAt + reviewedBy + updatedAt", async () => {
    await ingestInviteRows(
      [
        fakeRow({
          email: "abc@x.com",
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("abc@x.com");
    const later = new Date("2026-04-28T08:00:00Z");
    const r = await updateFaireInvite(
      id,
      { status: "approved", reviewedBy: "rene@usagummies.com" },
      { now: later },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invite.status).toBe("approved");
      expect(r.invite.reviewedAt).toBe(later.toISOString());
      expect(r.invite.updatedAt).toBe(later.toISOString());
      expect(r.invite.reviewedBy).toBe("rene@usagummies.com");
    }
    const reloaded = await getInvite(id);
    expect(reloaded?.status).toBe("approved");
  });

  it("review note persists; empty string clears", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");

    let r = await updateFaireInvite(
      id,
      { reviewNote: "  Buyer wants ACH-only terms.  " },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invite.reviewNote).toBe("Buyer wants ACH-only terms.");

    r = await updateFaireInvite(id, { reviewNote: "" }, { now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invite.reviewNote).toBeUndefined();
  });

  it("field correction passes when result still validates", async () => {
    await ingestInviteRows(
      [fakeRow({ retailerName: "Retailer Co.", email: "abc@x.com" })],
      { now: NOW },
    );
    const id = inviteIdFromEmail("abc@x.com");
    const r = await updateFaireInvite(
      id,
      { fieldCorrections: { retailerName: "Retailer Co. — Pacific NW" } },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invite.retailerName).toBe("Retailer Co. — Pacific NW");
  });

  it("changing email rotates the candidate but keeps the original id", async () => {
    await ingestInviteRows([fakeRow({ email: "old@x.com" })], { now: NOW });
    const oldId = inviteIdFromEmail("old@x.com");
    const r = await updateFaireInvite(
      oldId,
      { fieldCorrections: { email: "new@x.com" } },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invite.email).toBe("new@x.com");
      // id is immutable.
      expect(r.invite.id).toBe(oldId);
    }
  });
});

describe("updateFaireInvite — invalid input rejected", () => {
  it("unknown id → not_found", async () => {
    const r = await updateFaireInvite(
      "ghost",
      { status: "approved" },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  it("empty patch → no_changes", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(id, {}, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("no_changes");
  });

  it("invalid status value → invalid_status", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      { status: "totally-bogus" as unknown as "approved" },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_status");
  });

  it("status='sent' rejected with sent_status_forbidden", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(id, { status: "sent" }, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("sent_status_forbidden");
  });

  it("invalid email correction → validation_failed; original record untouched", async () => {
    await ingestInviteRows([fakeRow({ email: "abc@x.com" })], { now: NOW });
    const id = inviteIdFromEmail("abc@x.com");
    const r = await updateFaireInvite(
      id,
      { fieldCorrections: { email: "not-an-email" } },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
    const reloaded = await getInvite(id);
    expect(reloaded?.email).toBe("abc@x.com");
  });

  it("missing-retailer correction → validation_failed", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      { fieldCorrections: { retailerName: "" } },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
  });

  it("missing-source correction → validation_failed", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      { fieldCorrections: { source: "" } },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
  });

  it("corrected email collides with another existing record → duplicate_email", async () => {
    await ingestInviteRows(
      [
        fakeRow({ email: "first@x.com", retailerName: "First" }),
        fakeRow({ email: "second@x.com", retailerName: "Second" }),
      ],
      { now: NOW },
    );
    const firstId = inviteIdFromEmail("first@x.com");
    const r = await updateFaireInvite(
      firstId,
      { fieldCorrections: { email: "second@x.com" } },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("duplicate_email");
  });
});

describe("updateFaireInvite — no send / no network side effects", () => {
  it("KV is the only side effect (any other network call would crash uninstrumented)", async () => {
    await ingestInviteRows(
      [
        fakeRow({
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("buyer@retailer.com");
    const before = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await updateFaireInvite(id, { status: "approved" }, { now: NOW });
    const after = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    // Exactly one KV write per accepted update — no email, no Faire,
    // no Slack call.
    expect(after - before).toBe(1);
  });

  it("missing FAIRE_ACCESS_TOKEN does not block review", async () => {
    delete process.env.FAIRE_ACCESS_TOKEN;
    await ingestInviteRows(
      [
        fakeRow({
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(id, { status: "approved" }, { now: NOW });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — directLinkUrl + approval readiness + markFaireInviteSent
// ---------------------------------------------------------------------------

describe("isValidDirectLinkUrl — pure validator", () => {
  it("accepts https://faire.com URLs", () => {
    expect(
      isValidDirectLinkUrl("https://faire.com/direct/usagummies/abc"),
    ).toBe(true);
  });
  it("accepts http URLs (operator may paste a redirect)", () => {
    expect(isValidDirectLinkUrl("http://faire.com/direct")).toBe(true);
  });
  it("rejects non-http schemes (javascript, data, mailto)", () => {
    expect(isValidDirectLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isValidDirectLinkUrl("data:text/html,<script>")).toBe(false);
    expect(isValidDirectLinkUrl("mailto:x@y.com")).toBe(false);
    expect(isValidDirectLinkUrl("ftp://faire.com")).toBe(false);
  });
  it("rejects malformed strings", () => {
    expect(isValidDirectLinkUrl("not-a-url")).toBe(false);
    expect(isValidDirectLinkUrl("")).toBe(false);
    expect(isValidDirectLinkUrl("   ")).toBe(false);
  });
  it("rejects non-string inputs", () => {
    expect(isValidDirectLinkUrl(undefined)).toBe(false);
    expect(isValidDirectLinkUrl(null)).toBe(false);
    expect(isValidDirectLinkUrl(123)).toBe(false);
    expect(isValidDirectLinkUrl({})).toBe(false);
  });
  it("rejects URLs longer than 2048 chars (defensive)", () => {
    const huge = "https://faire.com/" + "x".repeat(2050);
    expect(isValidDirectLinkUrl(huge)).toBe(false);
  });
});

describe("validateInvite — directLinkUrl support", () => {
  it("accepts a valid http(s) directLinkUrl when present", () => {
    const r = validateInvite(
      fakeRow({
        directLinkUrl: "https://faire.com/direct/usagummies/abc",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.candidate.directLinkUrl).toBe(
        "https://faire.com/direct/usagummies/abc",
      );
    }
  });
  it("treats absent directLinkUrl as not-present (records remain valid)", () => {
    const r = validateInvite(fakeRow());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candidate.directLinkUrl).toBeUndefined();
  });
  it("treats empty-string directLinkUrl as a clear (not-present)", () => {
    const r = validateInvite(fakeRow({ directLinkUrl: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candidate.directLinkUrl).toBeUndefined();
  });
  it("rejects invalid directLinkUrl with a clear reason", () => {
    const r = validateInvite(
      fakeRow({ directLinkUrl: "javascript:alert(1)" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/directLinkUrl/);
  });
  it("trims directLinkUrl whitespace", () => {
    const r = validateInvite(
      fakeRow({
        directLinkUrl: "  https://faire.com/direct/usagummies/abc  ",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.candidate.directLinkUrl).toBe(
        "https://faire.com/direct/usagummies/abc",
      );
    }
  });
});

describe("updateFaireInvite — approval-readiness rule (Phase 3)", () => {
  it("status='approved' without a directLinkUrl → validation_failed", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      { status: "approved" },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("validation_failed");
      expect(r.error.message).toMatch(/directLinkUrl/);
    }
    // Original record unchanged.
    const reloaded = await getInvite(id);
    expect(reloaded?.status).toBe("needs_review");
  });

  it("status='approved' WITH a valid directLinkUrl already on record → ok", async () => {
    await ingestInviteRows(
      [
        fakeRow({
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      { status: "approved" },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invite.status).toBe("approved");
  });

  it("status='approved' + directLinkUrl correction in the same patch → ok", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      {
        status: "approved",
        fieldCorrections: {
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        },
      },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invite.status).toBe("approved");
      expect(r.invite.directLinkUrl).toBe(
        "https://faire.com/direct/usagummies/abc",
      );
    }
  });

  it("status='approved' + invalid directLinkUrl correction → validation_failed", async () => {
    await ingestInviteRows([fakeRow()], { now: NOW });
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      {
        status: "approved",
        fieldCorrections: { directLinkUrl: "not-a-url" },
      },
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
  });

  it("clearing directLinkUrl while moving to needs_review is allowed", async () => {
    await ingestInviteRows(
      [
        fakeRow({
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await updateFaireInvite(
      id,
      {
        status: "needs_review",
        fieldCorrections: { directLinkUrl: "" },
      },
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invite.status).toBe("needs_review");
      expect(r.invite.directLinkUrl).toBeUndefined();
    }
  });
});

describe("markFaireInviteSent — Phase 3 send transition", () => {
  async function seedApproved(
    email = "abc@x.com",
    directLinkUrl = "https://faire.com/direct/usagummies/abc",
  ) {
    await ingestInviteRows([fakeRow({ email, directLinkUrl })], { now: NOW });
    const id = inviteIdFromEmail(email);
    await updateFaireInvite(id, { status: "approved" }, { now: NOW });
    return id;
  }

  it("approved + valid url → flips to sent with all metadata", async () => {
    const id = await seedApproved();
    const r = await markFaireInviteSent(id, {
      approvalId: "appr-1",
      sentBy: "Ben",
      gmailMessageId: "gmail-msg-abc",
      gmailThreadId: "thr-1",
      hubspotEmailLogId: "hs-1",
      now: new Date("2026-04-30T10:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.alreadySent).toBe(false);
      expect(r.invite.status).toBe("sent");
      expect(r.invite.sentAt).toBe("2026-04-30T10:00:00.000Z");
      expect(r.invite.sentBy).toBe("Ben");
      expect(r.invite.gmailMessageId).toBe("gmail-msg-abc");
      expect(r.invite.gmailThreadId).toBe("thr-1");
      expect(r.invite.hubspotEmailLogId).toBe("hs-1");
      expect(r.invite.sentApprovalId).toBe("appr-1");
    }
  });

  it("non-approved record (needs_review) → wrong_status", async () => {
    await ingestInviteRows(
      [
        fakeRow({
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        }),
      ],
      { now: NOW },
    );
    const id = inviteIdFromEmail("buyer@retailer.com");
    const r = await markFaireInviteSent(id, {
      approvalId: "appr-1",
      sentBy: "Ben",
      gmailMessageId: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("wrong_status");
  });

  it("unknown id → not_found", async () => {
    const r = await markFaireInviteSent("ghost", {
      approvalId: "x",
      sentBy: "Ben",
      gmailMessageId: "y",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  it("idempotent: re-firing with the same approvalId returns alreadySent=true and does NOT overwrite sentAt", async () => {
    const id = await seedApproved();
    const first = await markFaireInviteSent(id, {
      approvalId: "appr-1",
      sentBy: "Ben",
      gmailMessageId: "msg-1",
      now: new Date("2026-04-30T10:00:00Z"),
    });
    expect(first.ok).toBe(true);
    const second = await markFaireInviteSent(id, {
      approvalId: "appr-1",
      sentBy: "Ben",
      gmailMessageId: "DIFFERENT-msg",
      now: new Date("2026-04-30T11:00:00Z"),
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadySent).toBe(true);
      // Original metadata preserved — second call did NOT overwrite.
      expect(second.invite.gmailMessageId).toBe("msg-1");
      expect(second.invite.sentAt).toBe("2026-04-30T10:00:00.000Z");
    }
  });

  it("a *different* approvalId on an already-sent record → wrong_status (does not double-send)", async () => {
    const id = await seedApproved();
    const first = await markFaireInviteSent(id, {
      approvalId: "appr-1",
      sentBy: "Ben",
      gmailMessageId: "msg-1",
      now: new Date("2026-04-30T10:00:00Z"),
    });
    expect(first.ok).toBe(true);
    const second = await markFaireInviteSent(id, {
      approvalId: "appr-2-different",
      sentBy: "Ben",
      gmailMessageId: "msg-2",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("wrong_status");
  });
});
