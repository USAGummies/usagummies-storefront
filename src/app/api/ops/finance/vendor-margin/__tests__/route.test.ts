import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";

function req(path = "/api/ops/finance/vendor-margin"): Request {
  return new Request(`https://www.usagummies.com${path}`);
}

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

describe("GET /api/ops/finance/vendor-margin", () => {
  it("401s when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns the parsed full ledger", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: { path: string; version: string | null };
      counts: {
        committedVendors: number;
        channelRows: number;
        pendingVendors: number;
      };
      ledger: {
        committedVendors: Array<{ slug: string; pricePerBagUsd: number | null }>;
        pendingVendors: Array<{ vendor: string }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.source).toMatchObject({
      path: "contracts/per-vendor-margin-ledger.md",
      version: "v0.1",
    });
    expect(body.counts.committedVendors).toBe(6);
    expect(body.counts.pendingVendors).toBeGreaterThan(10);
    expect(
      body.ledger.committedVendors.find((row) =>
        row.slug.includes("thanksgiving-point"),
      )?.pricePerBagUsd,
    ).toBe(3.49);
  });

  it("returns one committed vendor by slug-like query", async () => {
    const res = await GET(
      req("/api/ops/finance/vendor-margin?vendor=thanksgiving-point"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vendor: {
        name: string;
        pricePerBagUsd: number | null;
        marginAlert: string;
      } | null;
      ledger?: unknown;
    };
    expect(body.vendor?.name).toContain("Thanksgiving Point");
    expect(body.vendor?.pricePerBagUsd).toBe(3.49);
    expect(body.vendor?.marginAlert).toBe("healthy");
    expect(body.ledger).toBeUndefined();
  });

  it("404s for an unknown committed vendor without returning a fake row", async () => {
    const res = await GET(
      req("/api/ops/finance/vendor-margin?vendor=not-a-real-vendor"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; ok: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("vendor_not_found");
  });

  it("is read-only and exports only GET", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/finance/vendor-margin/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toMatch(/qbo-client|hubspot-client|fetchShopify|gmail-reader|slack-client/i);
  });
});
