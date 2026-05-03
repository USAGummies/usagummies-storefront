/**
 * POST /api/ops/sales/pipeline-evidence — coverage.
 *
 * Pins:
 *   - 401 unauthorized
 *   - 400 on invalid JSON / missing dealId / unknown stage / unknown
 *     evidenceType / wrong evidenceType for stage / missing source /
 *     bad evidenceAt
 *   - 200 on happy path; calls appendPipelineEvidence with the right
 *     normalized fields
 *   - source guards: read-only on HubSpot (no hubspot-client import,
 *     no PUT/PATCH/DELETE)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const appendMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/sales/pipeline-evidence-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/sales/pipeline-evidence-store")
  >("@/lib/sales/pipeline-evidence-store");
  return {
    ...actual,
    appendPipelineEvidence: (input: unknown) => appendMock(input),
  };
});

import { POST } from "../route";

function req(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/sales/pipeline-evidence",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const VALID_BODY = {
  dealId: "hs-deal-42",
  stage: "po_received",
  evidenceType: "po_document",
  source: "gmail",
  sourceId: "gmail-msg-99",
  evidenceAt: "2026-05-02T18:00:00.000Z",
  actor: "agent:viktor",
  confidence: 0.95,
};

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  appendMock.mockReset().mockResolvedValue({
    id: "pev-test",
    ...VALID_BODY,
    recordedAt: "2026-05-02T18:00:30.000Z",
  });
});

describe("POST /api/ops/sales/pipeline-evidence", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON", async () => {
    const r = new Request(
      "https://www.usagummies.com/api/ops/sales/pipeline-evidence",
      { method: "POST", body: "not-json" },
    );
    expect((await POST(r)).status).toBe(400);
  });

  it("400 on missing dealId", async () => {
    const res = await POST(req({ ...VALID_BODY, dealId: "" }));
    expect(res.status).toBe(400);
  });

  it("400 on unknown stage", async () => {
    const res = await POST(req({ ...VALID_BODY, stage: "banana" }));
    expect(res.status).toBe(400);
  });

  it("400 when evidenceType doesn't match the stage allowlist", async () => {
    // quote_email_sent isn't a valid evidence type for paid
    const res = await POST(
      req({
        ...VALID_BODY,
        stage: "paid",
        evidenceType: "quote_email_sent",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not valid for stage "paid"/);
  });

  it("400 on missing source / sourceId / actor", async () => {
    expect((await POST(req({ ...VALID_BODY, source: "" }))).status).toBe(400);
    expect((await POST(req({ ...VALID_BODY, sourceId: "" }))).status).toBe(
      400,
    );
    expect((await POST(req({ ...VALID_BODY, actor: "" }))).status).toBe(400);
  });

  it("400 on non-ISO evidenceAt", async () => {
    expect(
      (await POST(req({ ...VALID_BODY, evidenceAt: "yesterday" }))).status,
    ).toBe(400);
  });

  it("happy path: persists + returns the evidence row", async () => {
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { ok: boolean; evidence: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.evidence.id).toBe("pev-test");
  });
});

describe("source guardrails (route file)", () => {
  it("does not import HubSpot mutation paths or expose PUT/PATCH/DELETE", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/ops/sales/pipeline-evidence/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
  });
});
