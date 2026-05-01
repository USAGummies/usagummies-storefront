import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryAuditStore } from "@/lib/ops/control-plane/stores/memory-stores";
import { __resetStores, __setStoresForTest } from "@/lib/ops/control-plane/stores";

import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

const mocks = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  kvGet: vi.fn(),
}));

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => mocks.isAuthorized(req),
}));

vi.mock("@vercel/kv", () => ({
  kv: {
    get: (key: string) => mocks.kvGet(key),
  },
}));

import { GET } from "../route";

function req(path = "/api/ops/finance/off-grid"): Request {
  return new Request(`https://www.usagummies.com${path}`);
}

function audit(after: Record<string, unknown>): AuditLogEntry {
  return {
    id: `audit-${Math.random()}`,
    runId: "run-1",
    division: "sales",
    actorType: "agent",
    actorId: "sales-tour-booth-quote",
    action: "sales-tour.booth-quote.composed",
    entityType: "booth-visit",
    entityId: "visit-1",
    result: "ok",
    after,
    sourceCitations: [],
    confidence: 0.9,
    createdAt: "2026-04-30T18:00:00.000Z",
  };
}

function storedQuote(pricePerBag = 3) {
  return JSON.stringify({
    intent: {
      rawText: "/booth 3 pallets to Bryce Glamp UT, anchor",
      prospectName: "Bryce Glamp",
      state: "UT",
      city: null,
      scale: "pallet",
      count: 3,
      totalBags: 2700,
      freightAsk: "anchor",
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      notes: null,
      confidence: 0.9,
    },
    lines: [
      {
        bGridDesignator: null,
        pricingClass: "C-ANCH",
        pricePerBag,
        freightStance: "landed",
        totalUsd: pricePerBag * 2700,
        label: "3 pallets",
      },
    ],
    freight: {
      source: "regional-table-v0.1",
      drivePerPallet: 400,
      ltlPerPallet: 600,
      totalDrive: 1200,
      totalLtl: 1800,
      state: "UT",
      found: true,
      driveFreightPerBag: 0.44,
    },
    escalationClause: "Escalation clause",
    approval: "class-c",
    approvalReasons: ["off-grid"],
    dealCheckRequired: true,
    tourId: "may-2026",
    visitId: "visit-1",
    generatedAt: "2026-04-30T18:00:00.000Z",
    createdAt: "2026-04-30T18:00:00.000Z",
  });
}

beforeEach(() => {
  __resetStores();
  mocks.isAuthorized.mockReset();
  mocks.isAuthorized.mockResolvedValue(true);
  mocks.kvGet.mockReset();
});

describe("GET /api/ops/finance/off-grid", () => {
  it("401s when unauthorized", async () => {
    mocks.isAuthorized.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("reads booth quote audit entries and returns off-grid classifications", async () => {
    const store = new InMemoryAuditStore();
    await store.append(audit({ kvKey: "sales-tour:booth-visits:may-2026:visit-1" }));
    __setStoresForTest({ audit: store });
    mocks.kvGet.mockResolvedValueOnce(storedQuote(3.1));

    const res = await GET(req("/api/ops/finance/off-grid?limit=10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: { entriesRead: number };
      skipped: unknown[];
      slice: {
        candidatesEvaluated: number;
        topQuotes: Array<{
          severity: string;
          candidate: { customerName: string; pricePerBagUsd: number };
        }>;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.source.entriesRead).toBe(1);
    expect(body.skipped).toEqual([]);
    expect(body.slice.candidatesEvaluated).toBe(1);
    expect(body.slice.topQuotes[0]).toMatchObject({
      severity: "between_grid_lines",
      candidate: { customerName: "Bryce Glamp", pricePerBagUsd: 3.1 },
    });
  });

  it("does not count missing KV payloads as on-grid or off-grid", async () => {
    const store = new InMemoryAuditStore();
    await store.append(audit({ kvKey: "missing" }));
    __setStoresForTest({ audit: store });
    mocks.kvGet.mockResolvedValueOnce(null);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skipped: Array<{ reason: string }>;
      slice: { candidatesEvaluated: number; topQuotes: unknown[] };
    };

    expect(body.skipped).toEqual([
      { auditId: expect.any(String), entityId: "visit-1", reason: "quote_not_found_or_malformed" },
    ]);
    expect(body.slice.candidatesEvaluated).toBe(0);
    expect(body.slice.topQuotes).toEqual([]);
  });

  it("is read-only and exports only GET", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/finance/off-grid/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toMatch(/kv\.set|kv\.del|openApproval|recordDecision|postMessage|createDeal|updateDealStage|qbo-client|qbo-auth/i);
  });
});
