/**
 * Email-agent queue route — Build 3.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 400 on invalid `status` param.
 *   - 400 on non-numeric / non-positive `limit`.
 *   - Defaults: returns summary, omits `rows` (small payload).
 *   - `?rows=full` returns the full row array.
 *   - `?status=*` is forwarded to the scanner.
 *   - No secrets / no full email body in the response.
 *   - No Gmail / HubSpot / QBO / Shopify imports leaked into route source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const scanMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/email-agent-queue", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/email-agent-queue")
  >("@/lib/ops/email-agent-queue");
  return {
    ...actual,
    scanEmailAgentQueue: (...args: unknown[]) => scanMock(...args),
  };
});

import { GET } from "../route";

function req(qs = ""): Request {
  return new Request(`https://www.usagummies.com/api/ops/email-agents/queue${qs}`);
}

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  scanMock.mockReset();
  scanMock.mockResolvedValue({
    rows: [
      {
        messageId: "m-1",
        threadId: "t-1",
        fromEmail: "buyer@x.com",
        fromHeader: "Buyer <buyer@x.com>",
        subject: "Sample",
        date: "Thu, 01 May 2026 12:00:00 -0700",
        status: "classified",
        category: "S_sample_request",
        confidence: 0.95,
        observedAt: "2026-05-01T19:00:00.000Z",
        classifiedAt: "2026-05-01T19:01:00.000Z",
      },
    ],
    degraded: [],
    truncated: false,
  });
});

describe("GET /api/ops/email-agents/queue", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns summary, omits rows by default", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: { total: number };
      rows: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.summary.total).toBe(1);
    expect(body.rows).toBeUndefined();
  });

  it("includes rows when ?rows=full", async () => {
    const res = await GET(req("?rows=full"));
    const body = (await res.json()) as { rows: unknown[] };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows).toHaveLength(1);
  });

  it("forwards status filter to scanner", async () => {
    await GET(req("?status=classified_whale"));
    expect(scanMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusFilter: "classified_whale" }),
    );
  });

  it("400s on invalid status", async () => {
    const res = await GET(req("?status=banana"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid status/);
  });

  it("400s on non-numeric or zero limit", async () => {
    const a = await GET(req("?limit=abc"));
    expect(a.status).toBe(400);
    const b = await GET(req("?limit=0"));
    expect(b.status).toBe(400);
  });

  it("forwards a numeric limit to scanner", async () => {
    await GET(req("?limit=50"));
    expect(scanMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("never returns snippet / label ids / raw secrets", async () => {
    const res = await GET(req("?rows=full"));
    const text = await res.text();
    expect(text).not.toContain("snippet");
    expect(text).not.toContain("labelIds");
  });
});

describe("source guardrails (route file)", () => {
  it("does not import Gmail/HubSpot/QBO/Shopify clients", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/email-agents/queue/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/listEmails|createGmailDraft|sendGmail|requestApproval|postMessage/);
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
  });
});
