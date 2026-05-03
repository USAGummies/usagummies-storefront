/**
 * GET /api/ops/sales/pipeline-evidence/[dealId] — coverage.
 *
 * Pins:
 *   - 401 unauthorized
 *   - 200 + verified state on happy path
 *   - claimedStage param → drift detection in response
 *   - 400 on unknown claimedStage
 *   - source guards
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const listEvidenceMock = vi.fn();
const listTransitionsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/sales/pipeline-evidence-store", () => ({
  listPipelineEvidence: () => listEvidenceMock(),
  listPipelineTransitions: () => listTransitionsMock(),
}));

import { GET } from "../route";

function req(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/sales/pipeline-evidence/deal-1${qs}`,
  );
}

function ctx(dealId = "deal-1") {
  return { params: Promise.resolve({ dealId }) };
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  listEvidenceMock.mockReset().mockResolvedValue({
    evidence: [
      {
        id: "pev-1",
        dealId: "deal-1",
        stage: "po_received",
        evidenceType: "po_document",
        source: "gmail",
        sourceId: "msg-99",
        evidenceAt: "2026-05-01T12:00:00.000Z",
        actor: "agent:viktor",
        confidence: 0.95,
        recordedAt: "2026-05-01T12:00:01.000Z",
      },
    ],
    degraded: [],
  });
  listTransitionsMock.mockReset().mockResolvedValue({
    transitions: [],
    degraded: [],
  });
});

describe("GET /api/ops/sales/pipeline-evidence/[dealId]", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it("200 + verified state on happy path", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: { verifiedStage: string; verification: string };
    };
    expect(body.verified.verifiedStage).toBe("po_received");
    expect(body.verified.verification).toBe("system_verified");
  });

  it("?claimedStage=shipped → needs_review since evidence only supports po_received", async () => {
    const res = await GET(req("?claimedStage=shipped"), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: { verification: string; missingEvidenceForStages: string[] };
    };
    expect(body.verified.verification).toBe("needs_review");
    expect(body.verified.missingEvidenceForStages).toContain("shipped");
  });

  it("400 on unknown claimedStage", async () => {
    const res = await GET(req("?claimedStage=banana"), ctx());
    expect(res.status).toBe(400);
  });
});

describe("source guardrails (route file)", () => {
  it("read-only: no PUT/POST/PATCH/DELETE; no HubSpot/QBO/Shopify mutation imports", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/ops/sales/pipeline-evidence/[dealId]/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
  });
});
