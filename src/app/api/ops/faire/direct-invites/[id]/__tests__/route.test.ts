/**
 * Integration tests for PATCH /api/ops/faire/direct-invites/[id].
 *
 * Locked contracts:
 *   - 401 unauthenticated PATCH + GET.
 *   - 200 status update; review note persists; valid corrections succeed.
 *   - 422 invalid_status / validation_failed.
 *   - 422 sent_status_forbidden (sent is reserved for the future send
 *     closer — never settable from this route).
 *   - 409 duplicate_email when corrected email collides.
 *   - 404 unknown id.
 *   - 400 empty patch / invalid JSON.
 *   - missing FAIRE_ACCESS_TOKEN never blocks review.
 *   - **No send / Faire / Gmail / Slack network call** — only KV writes.
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
} from "@/lib/faire/invites";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function fakeRow(
  overrides: Partial<FaireInviteCandidate> = {},
): Partial<FaireInviteCandidate> {
  return {
    retailerName: "Test Retailer",
    email: "abc@x.com",
    source: "wholesale-page",
    // Phase 3: tests that flip status to "approved" need a valid
    // Faire Direct link URL on the seeded row, so we default it here.
    // The dedicated approval-readiness test below seeds a row WITHOUT
    // a link and asserts the rejection path.
    directLinkUrl: "https://faire.com/direct/usagummies/abc123",
    ...overrides,
  };
}

function makePatch(id: string, body: unknown): Request {
  return new Request(
    `http://localhost/api/ops/faire/direct-invites/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
function makeGet(id: string): Request {
  return new Request(
    `http://localhost/api/ops/faire/direct-invites/${id}`,
    { method: "GET" },
  );
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});

async function seedInvite(email = "abc@x.com") {
  await ingestInviteRows([fakeRow({ email })], {
    now: new Date("2026-04-27T12:00:00Z"),
  });
  return inviteIdFromEmail(email);
}

describe("auth gate", () => {
  it("PATCH 401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch(id, { status: "approved" }), ctx(id));
    expect(res.status).toBe(401);
  });
  it("GET 401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(makeGet("anything"), ctx("anything"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH happy paths", () => {
  it("status update returns 200 with reviewedAt + reviewedBy", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, {
        status: "approved",
        reviewedBy: "rene@usagummies.com",
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      invite: { status: string; reviewedAt?: string; reviewedBy?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.invite.status).toBe("approved");
    expect(body.invite.reviewedAt).toBeTruthy();
    expect(body.invite.reviewedBy).toBe("rene@usagummies.com");
  });

  it("review note persists", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, { reviewNote: "Buyer wants ACH-only terms." }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invite: { reviewNote?: string } };
    expect(body.invite.reviewNote).toBe("Buyer wants ACH-only terms.");
  });

  it("valid field correction returns 200 + persisted change", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, {
        fieldCorrections: { retailerName: "Renamed Co." },
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invite: { retailerName: string } };
    expect(body.invite.retailerName).toBe("Renamed Co.");
  });

  it("changing email keeps the original id", async () => {
    const id = await seedInvite("old@x.com");
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, {
        fieldCorrections: { email: "new@x.com" },
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invite: { id: string; email: string };
    };
    expect(body.invite.id).toBe(id);
    expect(body.invite.email).toBe("new@x.com");
  });
});

describe("PATCH error paths", () => {
  it("invalid_status → 422 with stable code", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, { status: "totally-bogus" }),
      ctx(id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_status");
  });

  it("status='sent' rejected with 422 sent_status_forbidden", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch(id, { status: "sent" }), ctx(id));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("sent_status_forbidden");
  });

  it("invalid email correction → 422 validation_failed", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, { fieldCorrections: { email: "not-an-email" } }),
      ctx(id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("missing-retailer correction → 422 validation_failed", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, { fieldCorrections: { retailerName: "" } }),
      ctx(id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("corrected email collides with another record → 409 duplicate_email", async () => {
    await ingestInviteRows(
      [
        fakeRow({ email: "first@x.com", retailerName: "First" }),
        fakeRow({ email: "second@x.com", retailerName: "Second" }),
      ],
      { now: new Date("2026-04-27T12:00:00Z") },
    );
    const firstId = inviteIdFromEmail("first@x.com");
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(firstId, {
        fieldCorrections: { email: "second@x.com" },
      }),
      ctx(firstId),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("duplicate_email");
  });

  it("unknown id → 404 not_found", async () => {
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("ghost", { status: "approved" }),
      ctx("ghost"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("empty patch → 400 no_changes", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch(id, {}), ctx(id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no_changes");
  });

  it("invalid JSON body → 400", async () => {
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const req = new Request(
      `http://localhost/api/ops/faire/direct-invites/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await PATCH(req, ctx(id));
    expect(res.status).toBe(400);
  });
});

describe("Phase 2 invariant — no sends, missing token doesn't block", () => {
  it("missing FAIRE_ACCESS_TOKEN → review still works (200)", async () => {
    delete process.env.FAIRE_ACCESS_TOKEN;
    const id = await seedInvite();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, { status: "approved" }),
      ctx(id),
    );
    expect(res.status).toBe(200);
  });

  it("PATCH writes ONLY to KV (any other side effect would crash uninstrumented)", async () => {
    const id = await seedInvite();
    const before = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const { PATCH } = await import("../route");
    await PATCH(makePatch(id, { status: "approved" }), ctx(id));
    const after = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    // Exactly one KV write per accepted update.
    expect(after - before).toBe(1);
  });
});

describe("GET single invite", () => {
  it("returns the invite when id exists", async () => {
    const id = await seedInvite();
    const { GET } = await import("../route");
    const res = await GET(makeGet(id), ctx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invite: { id: string } };
    expect(body.invite.id).toBe(id);
  });
  it("404 when id missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeGet("ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — approval-readiness rule on PATCH route
// ---------------------------------------------------------------------------

describe("Phase 3 — PATCH refuses status='approved' without a directLinkUrl", () => {
  async function seedNoLink(email = "no-link@x.com") {
    await ingestInviteRows(
      [
        {
          retailerName: "No Link Retailer",
          email,
          source: "wholesale-page",
          // explicitly no directLinkUrl
        },
      ],
      { now: new Date("2026-04-27T12:00:00Z") },
    );
    return inviteIdFromEmail(email);
  }

  it("status='approved' without link → 422 validation_failed", async () => {
    const id = await seedNoLink();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch(id, { status: "approved" }), ctx(id));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("validation_failed");
    expect(body.error).toMatch(/directLinkUrl/);
  });

  it("status='approved' + directLinkUrl correction in same patch → 200", async () => {
    const id = await seedNoLink("link-in-patch@x.com");
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, {
        status: "approved",
        fieldCorrections: {
          directLinkUrl: "https://faire.com/direct/usagummies/abc",
        },
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invite: { status: string; directLinkUrl: string };
    };
    expect(body.invite.status).toBe("approved");
    expect(body.invite.directLinkUrl).toBe(
      "https://faire.com/direct/usagummies/abc",
    );
  });

  it("invalid directLinkUrl correction → 422 validation_failed", async () => {
    const id = await seedNoLink("invalid-link@x.com");
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch(id, {
        fieldCorrections: { directLinkUrl: "javascript:alert(1)" },
      }),
      ctx(id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });
});
