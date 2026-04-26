/**
 * Tests for GET /api/ops/docs/receipt-review-packets/audit-feed
 * (Phase 25 — recent-activity audit feed for the dashboard).
 *
 * Locked rules:
 *   - 401 on auth fail.
 *   - 200 with empty list when no closer audit entries exist.
 *   - 200 with newest-first entries (per byAction adapter contract).
 *   - `limit` query param clamped server-side to [1, 100] (default 20).
 *   - 500 on auditStore exception — never returns `count: 0` silently.
 *   - Static-source assertion: route imports nothing from QBO/HubSpot/
 *     Shopify writes / Slack send / approval-store mutation /
 *     openApproval / buildApprovalRequest. Only GET exported.
 *   - Defensive projection: malformed audit entries are SKIPPED via
 *     `projectAuditEntryToFeedRow` (the route's filter step).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

let auditByActionShouldThrow = false;
const auditEntriesByAction: AuditLogEntry[] = [];

vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({
    byAction: vi.fn(async (_action: string, limit: number) => {
      if (auditByActionShouldThrow) throw new Error("ECONNREFUSED");
      // Mirror the canonical byAction adapter: newest-first, capped.
      return auditEntriesByAction.slice(0, Math.max(0, limit));
    }),
  }),
}));

import { GET } from "../route";

beforeEach(() => {
  auditByActionShouldThrow = false;
  auditEntriesByAction.length = 0;
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(
  path = "/api/ops/docs/receipt-review-packets/audit-feed",
): Request {
  return new Request(`https://www.usagummies.com${path}`, { method: "GET" });
}

function mkOkEntry(
  overrides: Partial<{
    id: string;
    packetId: string;
    newStatus: "rene-approved" | "rejected";
    approvalId: string;
    createdAt: string;
  }> = {},
): AuditLogEntry {
  return {
    id: overrides.id ?? "audit-x",
    runId: "run-x",
    division: "financials",
    actorType: "agent",
    actorId: "receipt-review-promote-closer",
    action: "receipt-review-promote.closer",
    entityType: "receipt-review-packet",
    entityId: overrides.packetId ?? "pkt-v1-foo",
    after: {
      packetId: overrides.packetId ?? "pkt-v1-foo",
      newStatus: overrides.newStatus ?? "rene-approved",
    },
    result: "ok",
    approvalId: overrides.approvalId ?? "appr-foo",
    sourceCitations: [],
    createdAt: overrides.createdAt ?? "2026-04-26T12:00:00Z",
  };
}

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });
});

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("200 with empty list when no closer audit entries exist", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      entries: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(0);
    expect(body.entries).toEqual([]);
  });

  it("200 with projected entries (newest-first per byAction contract)", async () => {
    auditEntriesByAction.push(
      mkOkEntry({
        id: "a-newest",
        packetId: "pkt-v1-belmark",
        newStatus: "rene-approved",
        createdAt: "2026-04-26T12:00:00Z",
      }),
      mkOkEntry({
        id: "a-mid",
        packetId: "pkt-v1-uline",
        newStatus: "rejected",
        createdAt: "2026-04-26T11:30:00Z",
      }),
      mkOkEntry({
        id: "a-oldest",
        packetId: "pkt-v1-albanese",
        newStatus: "rene-approved",
        createdAt: "2026-04-26T10:00:00Z",
      }),
    );
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      entries: Array<{ id: string; newStatus: string; packetId: string }>;
    };
    expect(body.count).toBe(3);
    expect(body.entries.map((e) => e.id)).toEqual([
      "a-newest",
      "a-mid",
      "a-oldest",
    ]);
    expect(body.entries[0].newStatus).toBe("rene-approved");
    expect(body.entries[1].newStatus).toBe("rejected");
  });

  it("limit query param clamps to [1, 100]", async () => {
    for (let i = 0; i < 50; i++) {
      auditEntriesByAction.push(
        mkOkEntry({ id: `a-${i}`, packetId: `pkt-v1-${i}` }),
      );
    }
    // limit=0 → clamped to 1
    const lo = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/audit-feed?limit=0"),
    );
    const loBody = (await lo.json()) as { count: number };
    expect(loBody.count).toBe(1);

    // limit=999999 → clamped to 100; we have 50 entries so count=50
    const hi = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/audit-feed?limit=999999",
      ),
    );
    const hiBody = (await hi.json()) as { count: number };
    expect(hiBody.count).toBe(50);

    // negative → clamped to 1
    const neg = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/audit-feed?limit=-5"),
    );
    const negBody = (await neg.json()) as { count: number };
    expect(negBody.count).toBe(1);
  });

  it("default limit is 20 when no limit param is provided", async () => {
    for (let i = 0; i < 30; i++) {
      auditEntriesByAction.push(
        mkOkEntry({ id: `a-${i}`, packetId: `pkt-v1-${i}` }),
      );
    }
    const res = await GET(makeReq());
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(20);
  });
});

describe("error path — never fabricates count: 0", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("auditStore throw → 500 with reason, NOT 200 with count: 0", async () => {
    auditByActionShouldThrow = true;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      reason: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("audit_feed_read_failed");
    expect(body.reason).toContain("ECONNREFUSED");
  });
});

describe("defensive projection — malformed entries are skipped", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("ok entry with missing newStatus → SKIPPED, count reflects only valid rows", async () => {
    auditEntriesByAction.push(
      // Valid entry
      mkOkEntry({ id: "good", packetId: "pkt-v1-good" }),
      // Malformed: ok result but no newStatus
      {
        ...mkOkEntry({ id: "bad-1", packetId: "pkt-v1-bad-1" }),
        after: { packetId: "pkt-v1-bad-1" }, // no newStatus
      },
    );
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      entries: Array<{ id: string }>;
    };
    expect(body.count).toBe(1);
    expect(body.entries[0].id).toBe("good");
  });

  it("error entry with missing error.message → SKIPPED (no fabrication)", async () => {
    auditEntriesByAction.push({
      ...mkOkEntry({ id: "err-no-message" }),
      result: "error",
      after: {},
      // error field missing
    });
    const res = await GET(makeReq());
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it("error entry WITH error.message projects through", async () => {
    auditEntriesByAction.push({
      ...mkOkEntry({ id: "err-with-message", packetId: "pkt-v1-err" }),
      result: "error",
      after: {},
      error: { message: "packet not found in KV" },
    });
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      entries: Array<{
        id: string;
        result: string;
        errorMessage: string | null;
        newStatus: string | null;
      }>;
    };
    expect(body.count).toBe(1);
    expect(body.entries[0].result).toBe("error");
    expect(body.entries[0].errorMessage).toBe("packet not found in KV");
    expect(body.entries[0].newStatus).toBeNull();
  });
});

describe("read-only contract — no forbidden imports", () => {
  it("the route imports nothing from QBO / HubSpot / Shopify / Slack send / approvalStore mutation / openApproval / buildApprovalRequest", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*shopify-/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    expect(src).not.toMatch(
      /createQBOBill|createQBOInvoice|createQBOJournalEntry/,
    );
    expect(src).not.toMatch(/chat\.postMessage|chat\.update|WebClient/);
    // No mutation through the approval store.
    expect(src).not.toMatch(/approvalStore\(\)\.put\b/);
    expect(src).not.toMatch(/approvalStore\(\)\.recordDecision\b/);
    // No openApproval / buildApprovalRequest call sites or imports.
    expect(src).not.toMatch(/import[^;]*\bopenApproval\b/);
    expect(src).not.toMatch(/import[^;]*\bbuildApprovalRequest\b/);
    expect(src).not.toMatch(/\bopenApproval\s*\(/);
    expect(src).not.toMatch(/\bbuildApprovalRequest\s*\(/);
    // Only GET exported.
    expect(src).not.toMatch(
      /export\s+(async\s+)?function\s+(POST|PUT|DELETE|PATCH)/,
    );
  });
});
