import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

import * as authModule from "@/lib/ops/abra-auth";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function req(): Request {
  return new Request("http://localhost/api/ops/sales/tour");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue(true);
});

describe("GET /api/ops/sales/tour", () => {
  it("401s unauthenticated requests", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns the checked-in May sales tour contract as a read-only report", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      summary: { total: number; warmOrHot: number; researchNeeded: number };
      prospects: Array<{ prospect: string; contactStatus: string }>;
    };

    expect(body.ok).toBe(true);
    expect(body.source).toBe("contracts/sales-tour-may-2026-prospect-list.md");
    expect(body.summary.total).toBeGreaterThan(70);
    expect(body.summary.warmOrHot).toBeGreaterThan(0);
    expect(body.summary.researchNeeded).toBeGreaterThan(0);
    expect(
      body.prospects.some((p) => /Thanksgiving Point/.test(p.prospect)),
    ).toBe(true);
  });

  it("does not fabricate email-ready status for TBD rows", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    const body = (await res.json()) as {
      prospects: Array<{ email: string; contactStatus: string }>;
    };
    const tbdRows = body.prospects.filter((row) => row.email === "TBD");
    expect(tbdRows.length).toBeGreaterThan(0);
    expect(tbdRows.every((row) => row.contactStatus !== "verified_email")).toBe(
      true,
    );
  });

  it("exports only GET", async () => {
    const route = await import("../route");
    expect(route.GET).toBeTypeOf("function");
    expect("POST" in route).toBe(false);
    expect("PATCH" in route).toBe(false);
    expect("DELETE" in route).toBe(false);
  });

  it("imports no send or CRM write clients", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/sales/tour/route.ts"),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .join("\n");
    expect(imports).not.toMatch(/gmail|hubspot|apollo|qbo|shopify|send-email/i);
    expect(source).not.toContain("@vercel/kv");
    expect(source).not.toContain("openApproval");
  });
});
