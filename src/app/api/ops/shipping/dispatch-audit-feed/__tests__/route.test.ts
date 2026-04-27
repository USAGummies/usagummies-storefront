/**
 * Phase 28g — dispatch audit feed route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 500 with reason when auditStore throws (NEVER returns count:0
 *     silently — operators need to know the feed is degraded).
 *   - Reads BOTH `shipping.dispatch.mark` AND `shipping.dispatch.clear`
 *     from auditStore, merged and sorted newest-first.
 *   - limit clamped to [1, 100], default 20.
 *   - Malformed audit entries are skipped (no fabrication) — the
 *     byAction filter guarantees the action matches; projection
 *     validates entityType + entityId shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const byActionMock = vi.fn();
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ byAction: byActionMock }),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  byActionMock.mockReset();
  byActionMock.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

function makeReq(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/shipping/dispatch-audit-feed${qs}`,
  );
}

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    division: "production-supply-chain",
    actorType: "agent",
    actorId: "shipping-dispatch-reaction",
    action: "shipping.dispatch.mark",
    entityType: "shipping.shipment",
    entityId: "amazon:112-1111111-1111111",
    after: {
      dispatchedAt: "2026-04-26T18:00:00.000Z",
      dispatchedBy: "U_OPERATOR",
      surface: "slack-reaction",
      postedThreadReply: true,
    },
    result: "ok",
    sourceCitations: [{ system: "amazon", id: "112-1111111-1111111" }],
    confidence: 1,
    createdAt: "2026-04-26T18:00:00.000Z",
    ...over,
  };
}

describe("GET /api/ops/shipping/dispatch-audit-feed", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("500 with reason when auditStore throws", async () => {
    byActionMock.mockRejectedValueOnce(new Error("KV down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/KV down/);
  });

  it("reads both mark + clear streams and merges newest-first", async () => {
    byActionMock.mockImplementation(async (action: string) => {
      if (action === "shipping.dispatch.mark") {
        return [
          entry({
            id: "m1",
            createdAt: "2026-04-26T18:00:00.000Z",
            entityId: "amazon:112-MARK1-1234567",
          }),
          entry({
            id: "m2",
            createdAt: "2026-04-26T16:00:00.000Z",
            entityId: "shopify:1077",
          }),
        ];
      }
      if (action === "shipping.dispatch.clear") {
        return [
          entry({
            id: "c1",
            action: "shipping.dispatch.clear",
            createdAt: "2026-04-26T17:00:00.000Z",
            entityId: "amazon:112-CLEAR1-9999999",
            after: { dispatchedAt: null },
          }),
        ];
      }
      return [];
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      entries: Array<{ id: string; action: string; timestampIso: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    // Newest-first: m1 (18:00) → c1 (17:00) → m2 (16:00)
    expect(body.entries.map((e) => e.id)).toEqual(["m1", "c1", "m2"]);
    expect(body.entries[1].action).toBe("clear");
  });

  it("malformed entries are skipped (no fabrication)", async () => {
    byActionMock.mockImplementation(async (action: string) => {
      if (action === "shipping.dispatch.mark") {
        return [
          entry({ id: "good" }),
          // Missing entityId — should be skipped
          entry({ id: "bad-no-entity-id", entityId: undefined }),
          // Wrong entityType — should be skipped
          entry({ id: "bad-wrong-type", entityType: "shipping.label" }),
        ];
      }
      return [];
    });
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      entries: Array<{ id: string }>;
    };
    expect(body.count).toBe(1);
    expect(body.entries[0].id).toBe("good");
  });

  it("limit clamps to [1, 100]; default 20", async () => {
    const res1 = await GET(makeReq("?limit=999"));
    expect(res1.status).toBe(200);
    // byAction should have been called with limit=100 for both streams.
    const calls = byActionMock.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][1]).toBe(100);

    byActionMock.mockClear();
    await GET(makeReq("?limit=0"));
    expect(byActionMock.mock.calls[0][1]).toBe(1);

    byActionMock.mockClear();
    await GET(makeReq());
    expect(byActionMock.mock.calls[0][1]).toBe(20);
  });

  it("final response slice respects limit (after merging both streams)", async () => {
    byActionMock.mockImplementation(async (action: string) => {
      if (action === "shipping.dispatch.mark") {
        return Array.from({ length: 10 }, (_, i) =>
          entry({
            id: `m${i}`,
            createdAt: `2026-04-26T${String(i).padStart(2, "0")}:00:00.000Z`,
            entityId: `amazon:112-${String(i).padStart(7, "0")}-1234567`,
          }),
        );
      }
      if (action === "shipping.dispatch.clear") {
        return Array.from({ length: 5 }, (_, i) =>
          entry({
            id: `c${i}`,
            action: "shipping.dispatch.clear",
            createdAt: `2026-04-26T${String(i + 12).padStart(2, "0")}:00:00.000Z`,
            entityId: `amazon:112-${String(i).padStart(7, "0")}-9876543`,
            after: { dispatchedAt: null },
          }),
        );
      }
      return [];
    });
    const res = await GET(makeReq("?limit=7"));
    const body = (await res.json()) as { count: number };
    // Both streams fetched 7 entries each (10 marks + 5 clears →
    // capped at 7 + 5 = up to 12 projected, sliced to 7 final).
    expect(body.count).toBe(7);
  });
});
