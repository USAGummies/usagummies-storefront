/**
 * Integration tests for GET /api/ops/faire/direct-invites/follow-ups.
 *
 * Locked contracts:
 *   - 401 unauthenticated.
 *   - 200 happy path: groups invites into overdue / due_soon / not_due.
 *   - Totals reflect grouping; sent_total counts every status="sent"
 *     invite even when its bucket is "not_due" (fresh / queued / etc).
 *   - Each actionable row carries a non-null `suggestedAction` string;
 *     not_due rows carry suggestedAction=null.
 *   - **Read-only.** Zero KV writes. Any kv.set call would be a
 *     contract violation.
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
  ingestInviteRows,
  inviteIdFromEmail,
  type FaireInviteCandidate,
  type FaireInviteRecord,
} from "@/lib/faire/invites";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<
  typeof vi.fn
>;

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

function makeReq(): Request {
  return new Request(
    "http://localhost/api/ops/faire/direct-invites/follow-ups",
    { method: "GET" },
  );
}

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Test helper — seeds an invite already in the "sent" state with a
 * specified sentAt. The follow-up classifier reads sentAt from KV,
 * so we have to actually persist a sent record (not just queue one).
 */
async function seedSentInvite(opts: {
  email: string;
  retailerName?: string;
  daysAgo: number;
  hubspotContactId?: string;
  followUpQueuedAt?: string;
}): Promise<string> {
  await ingestInviteRows(
    [
      fakeRow({
        email: opts.email,
        retailerName: opts.retailerName ?? "Test Retailer",
        hubspotContactId: opts.hubspotContactId,
      }),
    ],
    { now: new Date("2026-04-01T00:00:00Z") },
  );
  const id = inviteIdFromEmail(opts.email);
  const sentAt = new Date(
    Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  const record = (JSON.parse(
    (await kv.get<string>(`faire:invites:${id}`)) as string,
  ) as FaireInviteRecord);
  record.status = "sent";
  record.sentAt = sentAt;
  record.sentBy = "Ben";
  record.gmailMessageId = `gmail-${id}`;
  record.sentApprovalId = `appr-${id}`;
  if (opts.followUpQueuedAt) record.followUpQueuedAt = opts.followUpQueuedAt;
  await kv.set(`faire:invites:${id}`, JSON.stringify(record));
  return id;
}

describe("auth gate", () => {
  it("401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });
});

describe("GET happy path — grouping", () => {
  it("groups invites into overdue / due_soon / not_due with correct totals", async () => {
    await seedSentInvite({ email: "fresh@x.com", daysAgo: 1 });
    await seedSentInvite({ email: "due@x.com", daysAgo: 4 });
    await seedSentInvite({ email: "overdue1@x.com", daysAgo: 10 });
    await seedSentInvite({ email: "overdue2@x.com", daysAgo: 30 });
    // Plus a needs_review row that should land in not_due (wrong_status).
    await ingestInviteRows([fakeRow({ email: "ineligible@x.com" })], {
      now: new Date("2026-04-01T00:00:00Z"),
    });

    const { GET } = await import("../route");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totals: {
        overdue: number;
        due_soon: number;
        not_due: number;
        total: number;
        sent_total: number;
      };
      overdue: Array<{ id: string; bucket: string; suggestedAction: string }>;
      due_soon: Array<{ id: string; bucket: string; suggestedAction: string }>;
      not_due: Array<{
        id: string;
        bucket: string;
        suggestedAction: null;
        reason: { code: string };
      }>;
    };

    expect(body.ok).toBe(true);
    expect(body.totals.total).toBe(5);
    expect(body.totals.sent_total).toBe(4);
    expect(body.totals.overdue).toBe(2);
    expect(body.totals.due_soon).toBe(1);
    expect(body.totals.not_due).toBe(2); // fresh@ + ineligible@

    // Most-stale-first sort.
    expect(body.overdue.map((r) => r.id)).toEqual([
      inviteIdFromEmail("overdue2@x.com"),
      inviteIdFromEmail("overdue1@x.com"),
    ]);
    expect(body.due_soon.map((r) => r.id)).toEqual([
      inviteIdFromEmail("due@x.com"),
    ]);

    // Actionable rows carry suggestedAction; not_due rows do not.
    for (const row of body.overdue) expect(row.suggestedAction).toBeTruthy();
    for (const row of body.due_soon) expect(row.suggestedAction).toBeTruthy();
    for (const row of body.not_due) expect(row.suggestedAction).toBeNull();

    // Ineligible (needs_review) row carries wrong_status reason.
    const ineligible = body.not_due.find(
      (r) => r.id === inviteIdFromEmail("ineligible@x.com"),
    );
    expect(ineligible?.reason.code).toBe("wrong_status");
  });

  it("returns empty groups when there are no invites", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { total: number; overdue: number; due_soon: number; not_due: number; sent_total: number };
      overdue: unknown[];
      due_soon: unknown[];
      not_due: unknown[];
    };
    expect(body.totals.total).toBe(0);
    expect(body.totals.sent_total).toBe(0);
    expect(body.overdue).toEqual([]);
    expect(body.due_soon).toEqual([]);
    expect(body.not_due).toEqual([]);
  });

  it("surfaces hubspotContactId on actionable rows when present", async () => {
    await seedSentInvite({
      email: "hs@x.com",
      daysAgo: 10,
      hubspotContactId: "hs-99999",
    });
    const { GET } = await import("../route");
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      overdue: Array<{ id: string; hubspotContactId?: string }>;
    };
    expect(body.overdue[0].hubspotContactId).toBe("hs-99999");
  });

  it("a row with followUpQueuedAt is NOT surfaced as actionable", async () => {
    await seedSentInvite({
      email: "queued@x.com",
      daysAgo: 30, // would normally be wildly overdue
      followUpQueuedAt: new Date(Date.now() - 86400000).toISOString(),
    });
    const { GET } = await import("../route");
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      totals: { overdue: number; due_soon: number };
      not_due: Array<{ id: string; reason: { code: string } }>;
    };
    expect(body.totals.overdue).toBe(0);
    expect(body.totals.due_soon).toBe(0);
    const queued = body.not_due.find(
      (r) => r.id === inviteIdFromEmail("queued@x.com"),
    );
    expect(queued?.reason.code).toBe("follow_up_queued");
  });
});

describe("Phase 3.2 invariant — read-only", () => {
  it("GET writes ZERO times to KV", async () => {
    await seedSentInvite({ email: "x@x.com", daysAgo: 10 });
    // Reset write counter AFTER seeding.
    (kv.set as unknown as ReturnType<typeof vi.fn>).mockClear();
    const before = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const { GET } = await import("../route");
    await GET(makeReq());
    const after = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(after - before).toBe(0);
  });
});
