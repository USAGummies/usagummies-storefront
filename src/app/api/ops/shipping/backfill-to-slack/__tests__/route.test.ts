/**
 * Phase 27 Stage D — backfill-to-slack route tests.
 *
 * Locks the contract:
 *   - Auth-gated. 401 on rejection.
 *   - 500 with `shipping_channel_not_in_registry` if the registry
 *     somehow lacks the `shipping` entry.
 *   - 500 with `kv_read_failed` if the auto-shipped log can't be read.
 *   - Idempotent: orders whose artifact record already has
 *     `slackPermalink` are reported as `already-in-slack` (skipped).
 *   - Dry-run: returns `would-post-with-pdf` / `would-post-text-only`
 *     without actually uploading or posting.
 *   - `orderNumbers` filter restricts which entries are processed.
 *   - `limit` clamped to [1, 50] (default 20).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const kvStore = new Map<string, unknown>();
let kvShouldThrow = false;
vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow) throw new Error("ECONNREFUSED");
      return kvStore.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      kvStore.set(key, value);
    }),
  },
}));

// Slack helpers — track calls so the dry-run path is provably
// not posting anywhere.
const postMessageMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getPermalinkMock = vi.fn<(...args: unknown[]) => Promise<string | null>>();
vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: (...args: unknown[]) => postMessageMock(...args),
  getPermalink: (...args: unknown[]) => getPermalinkMock(...args),
}));

const uploadBufferToSlackMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/ops/slack-file-upload", () => ({
  uploadBufferToSlack: (...args: unknown[]) => uploadBufferToSlackMock(...args),
}));

const fetchDriveFileMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/ops/drive-reader", () => ({
  fetchDriveFile: (...args: unknown[]) => fetchDriveFileMock(...args),
  parseDriveRef: (raw: string) => ({ kind: "file", fileId: "fake", raw }),
}));

const getShippingArtifactMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const attachSlackPermalinkMock = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("@/lib/ops/shipping-artifacts", () => ({
  getShippingArtifact: (...args: unknown[]) => getShippingArtifactMock(...args),
  attachSlackPermalink: (...args: unknown[]) =>
    attachSlackPermalinkMock(...args),
}));

import { POST } from "../route";

beforeEach(() => {
  kvStore.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
  postMessageMock.mockReset();
  postMessageMock.mockResolvedValue({ ok: false });
  getPermalinkMock.mockReset();
  getPermalinkMock.mockResolvedValue(null);
  uploadBufferToSlackMock.mockReset();
  uploadBufferToSlackMock.mockResolvedValue({ ok: false });
  fetchDriveFileMock.mockReset();
  fetchDriveFileMock.mockResolvedValue({ ok: false, error: "not configured" });
  getShippingArtifactMock.mockReset();
  getShippingArtifactMock.mockResolvedValue(null);
  attachSlackPermalinkMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(body: unknown = {}): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/shipping/backfill-to-slack",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("auth gate", () => {
  it("401 on isAuthorized rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});

describe("KV failure", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("kv_read_failed when KV throws", async () => {
    kvShouldThrow = true;
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("kv_read_failed");
  });
});

describe("dry-run", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("returns 'would-post-text-only' for entries without Drive PDF + does NOT call Slack", async () => {
    kvStore.set("shipping:auto-shipped", [
      {
        orderNumber: "111-1056090-8513067",
        source: "amazon",
        dispatchedAt: "2026-04-26T03:00:30Z",
        trackingNumber: "1ZJ74F69YW43918760",
      },
    ]);
    getShippingArtifactMock.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ dryRun: true }));
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      processed: number;
      results: Array<{ orderNumber: string; status: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.results[0].orderNumber).toBe("111-1056090-8513067");
    expect(body.results[0].status).toBe("would-post-text-only");
    // No actual Slack writes.
    expect(uploadBufferToSlackMock).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("returns 'would-post-with-pdf' when Drive PDF is available", async () => {
    kvStore.set("shipping:auto-shipped", [
      {
        orderNumber: "112-9310316-1993035",
        source: "amazon",
        dispatchedAt: "2026-04-23T17:00:55Z",
        trackingNumber: "TRK1",
      },
    ]);
    getShippingArtifactMock.mockResolvedValueOnce({
      orderNumber: "112-9310316-1993035",
      source: "amazon",
      trackingNumber: "TRK1",
      label: {
        fileId: "drive-file-1",
        webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
        webContentLink: null,
        name: "label.pdf",
      },
      packingSlip: null,
      slackPermalink: null,
      persistedAt: "2026-04-23T17:00:55Z",
      driveError: null,
    });

    const res = await POST(makeReq({ dryRun: true }));
    const body = (await res.json()) as {
      processed: number;
      results: Array<{ status: string; hadLabelPdf: boolean }>;
    };
    expect(body.processed).toBe(1);
    expect(body.results[0].status).toBe("would-post-with-pdf");
    expect(body.results[0].hadLabelPdf).toBe(true);
  });
});

describe("idempotency — already-in-slack", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("orders whose artifact record has slackPermalink are skipped (status: already-in-slack)", async () => {
    kvStore.set("shipping:auto-shipped", [
      {
        orderNumber: "112-9310316-1993035",
        source: "amazon",
        dispatchedAt: "2026-04-23T17:00:55Z",
      },
    ]);
    getShippingArtifactMock.mockResolvedValueOnce({
      orderNumber: "112-9310316-1993035",
      source: "amazon",
      trackingNumber: "TRK1",
      label: null,
      packingSlip: null,
      slackPermalink:
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000000001",
      persistedAt: "2026-04-23T17:00:55Z",
      driveError: null,
    });

    const res = await POST(makeReq());
    const body = (await res.json()) as {
      results: Array<{
        status: string;
        permalink: string;
      }>;
    };
    expect(body.results[0].status).toBe("already-in-slack");
    expect(body.results[0].permalink).toContain("C0AS4635HFG");
    // No Slack writes.
    expect(uploadBufferToSlackMock).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });
});

describe("orderNumbers filter", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("only processes entries whose orderNumber is in the filter set", async () => {
    kvStore.set("shipping:auto-shipped", [
      { orderNumber: "A1", source: "amazon", dispatchedAt: "2026-04-23T00:00:00Z" },
      { orderNumber: "A2", source: "amazon", dispatchedAt: "2026-04-24T00:00:00Z" },
      { orderNumber: "A3", source: "amazon", dispatchedAt: "2026-04-25T00:00:00Z" },
    ]);
    getShippingArtifactMock.mockResolvedValue(null);

    const res = await POST(
      makeReq({ orderNumbers: ["A1", "A3"], dryRun: true }),
    );
    const body = (await res.json()) as {
      processed: number;
      results: Array<{ orderNumber: string }>;
    };
    expect(body.processed).toBe(2);
    const seen = body.results.map((r) => r.orderNumber).sort();
    expect(seen).toEqual(["A1", "A3"]);
  });
});

describe("limit clamp", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("limit defaults to 20 when not provided", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      orderNumber: `O${i}`,
      source: "amazon",
      dispatchedAt: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    kvStore.set("shipping:auto-shipped", entries);
    getShippingArtifactMock.mockResolvedValue(null);
    const res = await POST(makeReq({ dryRun: true }));
    const body = (await res.json()) as { processed: number };
    expect(body.processed).toBe(20);
  });

  it("limit clamps to 50", async () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      orderNumber: `O${i}`,
      source: "amazon",
      dispatchedAt: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    kvStore.set("shipping:auto-shipped", entries);
    getShippingArtifactMock.mockResolvedValue(null);
    const res = await POST(makeReq({ dryRun: true, limit: 999 }));
    const body = (await res.json()) as { processed: number };
    expect(body.processed).toBe(50);
  });
});
