import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

import * as authModule from "@/lib/ops/abra-auth";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function req(): Request {
  return new Request("http://localhost/api/ops/sales/prospects/day1");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue(true);
});

describe("GET /api/ops/sales/prospects/day1", () => {
  it("401s unauthenticated requests", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns the checked-in prospect CSV as a read-only report", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      summary: { total: number; emailReady: number };
      prospects: Array<{ company: string; contactMode: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("docs/playbooks/wholesale-prospects-day1.csv");
    expect(body.summary.total).toBeGreaterThan(70);
    expect(body.summary.emailReady).toBeGreaterThan(0);
    expect(body.prospects.some((p) => p.company === "Buc-ee's, Ltd.")).toBe(true);
  });

  it("does not expose synthetic email addresses for blank-email rows", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    const body = (await res.json()) as {
      prospects: Array<{ email: string; contactMode: string }>;
    };
    const blankEmailRows = body.prospects.filter((row) => !row.email);
    expect(blankEmailRows.length).toBeGreaterThan(0);
    expect(blankEmailRows.every((row) => row.contactMode !== "email_ready")).toBe(
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
      join(process.cwd(), "src/app/api/ops/sales/prospects/day1/route.ts"),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .join("\n");
    expect(imports).not.toMatch(/gmail|hubspot|apollo|qbo|shopify|send-email/i);
    expect(source).not.toContain("@vercel/kv");
  });
});
