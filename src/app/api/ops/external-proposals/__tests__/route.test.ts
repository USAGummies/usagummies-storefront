/**
 * /api/ops/external-proposals route — Build 8.
 *
 * Pins:
 *   - 401 when unauthorized (POST + GET).
 *   - POST: 400 on invalid body / unknown source / missing fields.
 *   - POST: validates + persists; returns flags + effective risk class.
 *   - POST: mutation-verb claim → flag + risk downgrade in response.
 *   - GET: returns summary + records + degraded passthrough.
 *   - Source guards: no Meta/HubSpot/QBO/Shopify/Gmail imports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const appendMock = vi.fn();
const listMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/external-proposals", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/external-proposals")
  >("@/lib/ops/external-proposals");
  return {
    ...actual,
    appendExternalProposal: (...args: unknown[]) => appendMock(...args),
    listExternalProposals: (...args: unknown[]) => listMock(...args),
  };
});

import { GET, POST } from "../route";

function postReq(body: unknown): Request {
  return new Request("https://www.usagummies.com/api/ops/external-proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/external-proposals${qs}`,
  );
}

const VALID = {
  source: "polsia",
  department: "sales",
  title: "Re-engage Reunion 2026 leads",
  proposedAction: "Draft a follow-up email for 4 booth leads",
  evidence: { claim: "4 leads went cold after first sample drop" },
  riskClass: "draft_only",
};

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  appendMock.mockReset().mockImplementation(async (input, flags) => ({
    id: "ext-test-1",
    status: "queued",
    flags,
    createdAt: "2026-05-02T20:00:00.000Z",
    updatedAt: "2026-05-02T20:00:00.000Z",
    ...input,
  }));
  listMock.mockReset().mockResolvedValue({ records: [], degraded: [] });
});

describe("POST /api/ops/external-proposals", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON body", async () => {
    const req = new Request(
      "https://www.usagummies.com/api/ops/external-proposals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on unknown source", async () => {
    const res = await POST(postReq({ ...VALID, source: "evilcorp" }));
    expect(res.status).toBe(400);
  });

  it("400 on missing required fields", async () => {
    const res = await POST(postReq({ ...VALID, title: "" }));
    expect(res.status).toBe(400);
  });

  it("happy path: persists + returns flags / effectiveRiskClass", async () => {
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      record: { id: string };
      flags: string[];
      effectiveRiskClass: string;
    };
    expect(body.ok).toBe(true);
    expect(body.record.id).toBe("ext-test-1");
    expect(body.flags).toEqual([]);
    expect(body.effectiveRiskClass).toBe("draft_only");
  });

  it("mutation-verb claim flags + downgrades risk class", async () => {
    const res = await POST(
      postReq({
        ...VALID,
        proposedAction: "Send an email blast to 200 leads",
        riskClass: "read_only",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: string[];
      effectiveRiskClass: string;
    };
    expect(body.flags).toContain("claims_direct_mutation");
    expect(body.effectiveRiskClass).toBe("approval_required");
  });
});

describe("GET /api/ops/external-proposals", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("returns summary + records + degraded", async () => {
    listMock.mockResolvedValueOnce({
      records: [
        {
          id: "ext-1",
          source: "polsia",
          department: "sales",
          title: "x",
          proposedAction: "x",
          evidence: { claim: "x" },
          riskClass: "draft_only",
          status: "queued",
          flags: [],
          createdAt: "2026-05-02T19:00:00.000Z",
          updatedAt: "2026-05-02T19:00:00.000Z",
        },
      ],
      degraded: ["kv-degraded"],
    });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { total: number; queued: number };
      records: unknown[];
      degraded: string[];
    };
    expect(body.summary.total).toBe(1);
    expect(body.summary.queued).toBe(1);
    expect(body.records).toHaveLength(1);
    expect(body.degraded).toEqual(["kv-degraded"]);
  });

  it("400 on non-numeric limit", async () => {
    const res = await GET(getReq("?limit=abc"));
    expect(res.status).toBe(400);
  });

  it("forwards numeric limit to listExternalProposals", async () => {
    await GET(getReq("?limit=10"));
    expect(listMock).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe("source guardrails (route file)", () => {
  it("does not import Meta/HubSpot/QBO/Shopify/Gmail mutation paths", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/external-proposals/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ads\//);
    expect(source).not.toMatch(
      /sendGmail|requestApproval|recordDecision|launchCampaign|listEmails/,
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(PUT|PATCH|DELETE)\b/,
    );
  });
});
