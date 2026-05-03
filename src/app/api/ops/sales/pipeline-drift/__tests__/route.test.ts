/**
 * POST /api/ops/sales/pipeline-drift — coverage.
 *
 * Pins:
 *   - 401 unauthorized
 *   - 400 on invalid body / empty deals / unknown stage
 *   - 200 + drift envelope when claimedStage > verified
 *   - 200 + clean response when claimedStage ≤ verified
 *   - summary.bySeverity counts the right buckets
 *   - source guards: no HubSpot mutation imports
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const listEvidenceMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/sales/pipeline-evidence-store", () => ({
  listPipelineEvidence: (dealId: string) => listEvidenceMock(dealId),
}));

import { POST } from "../route";

function req(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/sales/pipeline-drift",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  listEvidenceMock.mockReset().mockResolvedValue({
    evidence: [],
    degraded: [],
  });
});

describe("POST /api/ops/sales/pipeline-drift", () => {
  it("401 unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(
      req({ deals: [{ dealId: "d-1", hubspotStage: "interested" }] }),
    );
    expect(res.status).toBe(401);
  });

  it("400 on missing deals[]", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ deals: [] }))).status).toBe(400);
  });

  it("400 on unknown stage", async () => {
    const res = await POST(
      req({ deals: [{ dealId: "d-1", hubspotStage: "banana" }] }),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: claim ahead of evidence → drift envelope returned", async () => {
    listEvidenceMock.mockResolvedValueOnce({
      evidence: [
        {
          id: "pev-1",
          dealId: "d-1",
          stage: "quote_sent",
          evidenceType: "quote_email_sent",
          source: "gmail",
          sourceId: "msg-1",
          evidenceAt: "2026-05-01T12:00:00.000Z",
          actor: "agent:viktor",
          confidence: 0.9,
          recordedAt: "2026-05-01T12:00:01.000Z",
        },
      ],
      degraded: [],
    });
    const res = await POST(
      req({ deals: [{ dealId: "d-1", hubspotStage: "shipped" }] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: {
        driftCount: number;
        bySeverity: { threePlusStep: number };
      };
      drifted: Array<{ dealId: string; driftSteps: number }>;
    };
    expect(body.summary.driftCount).toBe(1);
    // quote_sent (5) → shipped (9) = 4 steps drift → threePlusStep
    expect(body.summary.bySeverity.threePlusStep).toBe(1);
    expect(body.drifted[0].dealId).toBe("d-1");
    expect(body.drifted[0].driftSteps).toBe(4);
  });

  it("clean: claim ≤ verified → no drift", async () => {
    listEvidenceMock.mockResolvedValueOnce({
      evidence: [
        {
          id: "pev-1",
          dealId: "d-1",
          stage: "po_received",
          evidenceType: "po_document",
          source: "gmail",
          sourceId: "msg-1",
          evidenceAt: "2026-05-01T12:00:00.000Z",
          actor: "agent:viktor",
          confidence: 0.95,
          recordedAt: "2026-05-01T12:00:01.000Z",
        },
      ],
      degraded: [],
    });
    const res = await POST(
      req({ deals: [{ dealId: "d-1", hubspotStage: "po_received" }] }),
    );
    const body = (await res.json()) as {
      summary: { clean: number; driftCount: number };
      drifted: unknown[];
    };
    expect(body.summary.clean).toBe(1);
    expect(body.summary.driftCount).toBe(0);
    expect(body.drifted).toEqual([]);
  });

  it("summary.bySeverity buckets — 1-step / 2-step / 3+-step / no-evidence", async () => {
    // 4 deals: 1-step, 2-step, 3-step, no-evidence
    listEvidenceMock
      .mockResolvedValueOnce({
        evidence: [
          {
            id: "pev-a",
            dealId: "a",
            stage: "po_received",
            evidenceType: "po_document",
            source: "gmail",
            sourceId: "1",
            evidenceAt: "2026-05-01T00:00:00.000Z",
            actor: "agent",
            confidence: 0.9,
            recordedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        degraded: [],
      })
      .mockResolvedValueOnce({
        evidence: [
          {
            id: "pev-b",
            dealId: "b",
            stage: "po_received",
            evidenceType: "po_document",
            source: "gmail",
            sourceId: "1",
            evidenceAt: "2026-05-01T00:00:00.000Z",
            actor: "agent",
            confidence: 0.9,
            recordedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        degraded: [],
      })
      .mockResolvedValueOnce({
        evidence: [
          {
            id: "pev-c",
            dealId: "c",
            stage: "interested",
            evidenceType: "buyer_reply_email",
            source: "gmail",
            sourceId: "1",
            evidenceAt: "2026-05-01T00:00:00.000Z",
            actor: "agent",
            confidence: 0.9,
            recordedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        degraded: [],
      })
      .mockResolvedValueOnce({ evidence: [], degraded: [] });

    const res = await POST(
      req({
        deals: [
          // a: po_received → invoice_sent = 1 step
          { dealId: "a", hubspotStage: "invoice_sent" },
          // b: po_received → paid = 2 steps
          { dealId: "b", hubspotStage: "paid" },
          // c: interested → invoice_sent = 7 steps (3+)
          { dealId: "c", hubspotStage: "invoice_sent" },
          // d: no evidence + claim paid = no-evidence drift
          { dealId: "d", hubspotStage: "paid" },
        ],
      }),
    );
    const body = (await res.json()) as {
      summary: {
        driftCount: number;
        bySeverity: {
          oneStep: number;
          twoStep: number;
          threePlusStep: number;
          noEvidence: number;
        };
      };
    };
    expect(body.summary.driftCount).toBe(4);
    expect(body.summary.bySeverity.oneStep).toBe(1);
    expect(body.summary.bySeverity.twoStep).toBe(1);
    expect(body.summary.bySeverity.threePlusStep).toBe(2); // c (7 steps) + d (no-evidence is also threePlusStep)
    expect(body.summary.bySeverity.noEvidence).toBe(1);
  });
});

describe("source guardrails (route file)", () => {
  it("does not import HubSpot mutation paths or expose PUT/PATCH/DELETE", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/ops/sales/pipeline-drift/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(GET|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
  });
});
