/**
 * Tests for the shipping-artifacts module.
 *
 * Locked contracts:
 *   - Drive write happens with the right folder layout (labels/<source>/).
 *   - splitLabelAndPackingSlip returns label-only (page 1) AND
 *     packing-slip-only (page 2) when the source has 2 pages.
 *   - Module is fail-soft: missing env or Drive errors return a record
 *     with null artifact refs and a populated `driveError`. NEVER throws.
 *   - KV row is written with the metadata so recent-labels can join.
 *   - attachSlackPermalink merges into the existing record.
 *   - bulkLookupArtifacts returns a Map keyed by orderNumber.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
  "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
  "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GCP_GMAIL_OAUTH_CLIENT_ID",
  "GCP_GMAIL_OAUTH_CLIENT_SECRET",
  "GCP_GMAIL_OAUTH_REFRESH_TOKEN",
];
const originalEnv: Record<string, string | undefined> = {};

// Mocked Vercel KV — in-memory store between tests.
vi.mock("@vercel/kv", () => {
  const map = new Map<string, string>();
  return {
    kv: {
      get: vi.fn(async (k: string) => map.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        map.set(k, v);
        return "OK";
      }),
      __store: map,
    },
  };
});

// Mock googleapis so we don't make real network calls.
const filesCreateMock = vi.fn();
const filesListMock = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    drive: () => ({
      files: {
        create: filesCreateMock,
        list: filesListMock,
      },
    }),
  },
}));

import { kv } from "@vercel/kv";

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  (kv as unknown as { __store: Map<string, string> }).__store.clear();
  filesCreateMock.mockReset();
  filesListMock.mockReset();
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  // Reset folder cache between tests (env changes invalidate it).
  const mod = await import("../shipping-artifacts");
  mod.__resetShippingArtifactsCacheForTest();
});

describe("shipping-artifacts", () => {
  describe("isShippingArtifactsConfigured", () => {
    it("returns true when shipping-specific parent + OAuth are set", async () => {
      process.env.GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID = "ship-parent";
      process.env.GMAIL_OAUTH_CLIENT_ID = "id";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "s";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "t";
      const { isShippingArtifactsConfigured } = await import(
        "../shipping-artifacts"
      );
      expect(isShippingArtifactsConfigured()).toBe(true);
    });

    it("falls back to GOOGLE_DRIVE_UPLOAD_PARENT_ID when shipping parent unset", async () => {
      process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID = "upload-parent";
      process.env.GMAIL_OAUTH_CLIENT_ID = "id";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "s";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "t";
      const { isShippingArtifactsConfigured } = await import(
        "../shipping-artifacts"
      );
      expect(isShippingArtifactsConfigured()).toBe(true);
    });

    it("returns false when no parent id is set", async () => {
      const { isShippingArtifactsConfigured } = await import(
        "../shipping-artifacts"
      );
      expect(isShippingArtifactsConfigured()).toBe(false);
    });

    it("returns false when OAuth refresh token is missing", async () => {
      process.env.GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID = "p";
      const { isShippingArtifactsConfigured } = await import(
        "../shipping-artifacts"
      );
      expect(isShippingArtifactsConfigured()).toBe(false);
    });
  });

  describe("persistLabelArtifacts (fail-soft when Drive unavailable)", () => {
    it("returns a record with null refs + driveError when env is missing", async () => {
      const { persistLabelArtifacts } = await import("../shipping-artifacts");
      const result = await persistLabelArtifacts({
        orderNumber: "112-6147345-5547445",
        source: "amazon",
        trackingNumber: "1ZJ74F69YW11720505",
        fullPdf: Buffer.from("fakepdf"),
      });
      expect(result.label).toBeNull();
      expect(result.packingSlip).toBeNull();
      expect(result.driveError).toMatch(/PARENT_ID/);
      expect(result.orderNumber).toBe("112-6147345-5547445");
      // KV write happens regardless — recent-labels can still surface
      // the row even without Drive content.
      expect(kv.set).toHaveBeenCalledTimes(1);
    });

    it("returns a record with null refs + driveError when OAuth env is missing", async () => {
      process.env.GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID = "ship-parent";
      const { persistLabelArtifacts } = await import("../shipping-artifacts");
      const result = await persistLabelArtifacts({
        orderNumber: "1052",
        source: "shopify",
        trackingNumber: "9400111202555555555555",
        fullPdf: Buffer.from("fakepdf"),
      });
      expect(result.label).toBeNull();
      expect(result.driveError).toMatch(/GMAIL_OAUTH_/);
    });
  });

  describe("persistLabelArtifacts (Drive happy path)", () => {
    beforeEach(() => {
      process.env.GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID = "root-parent";
      process.env.GMAIL_OAUTH_CLIENT_ID = "id";
      process.env.GMAIL_OAUTH_CLIENT_SECRET = "secret";
      process.env.GMAIL_OAUTH_REFRESH_TOKEN = "rt";
    });

    it("creates labels/<source>/ folders and uploads both pages", async () => {
      // Two folder ensures, two file uploads. List returns no matches
      // so create gets called for both folders.
      filesListMock.mockResolvedValue({ data: { files: [] } });
      filesCreateMock
        // ensureFolder("labels")
        .mockResolvedValueOnce({ data: { id: "labels-folder-id" } })
        // ensureFolder("amazon")
        .mockResolvedValueOnce({ data: { id: "amazon-folder-id" } })
        // upload label-only PDF
        .mockResolvedValueOnce({
          data: { id: "label-pdf-id", webViewLink: "https://drive/label" },
        })
        // upload packing-slip PDF
        .mockResolvedValueOnce({
          data: {
            id: "slip-pdf-id",
            webViewLink: "https://drive/slip",
          },
        });

      const { persistLabelArtifacts } = await import("../shipping-artifacts");
      const result = await persistLabelArtifacts({
        orderNumber: "112-6147345-5547445",
        source: "amazon",
        trackingNumber: "1ZJ74F69YW11720505",
        // The route pre-splits, so we feed both pages directly. The
        // module accepts pre-split bytes without re-parsing, which keeps
        // the test independent of pdf-lib.
        fullPdf: Buffer.from("ignored-when-presplit"),
        labelOnlyPdf: Buffer.from("LABEL-PAGE-1"),
        packingSlipOnlyPdf: Buffer.from("PACKING-SLIP-PAGE-2"),
      });

      expect(result.label?.fileId).toBe("label-pdf-id");
      expect(result.label?.webViewLink).toBe("https://drive/label");
      expect(result.packingSlip?.fileId).toBe("slip-pdf-id");
      expect(result.driveError).toBeNull();

      // Assert folder layout: labels root → source subfolder → upload.
      const calls = filesCreateMock.mock.calls;
      expect(calls[0][0].requestBody.name).toBe("labels");
      expect(calls[0][0].requestBody.parents).toEqual(["root-parent"]);
      expect(calls[1][0].requestBody.name).toBe("amazon");
      expect(calls[1][0].requestBody.parents).toEqual(["labels-folder-id"]);
      // File names include order number + suffix.
      expect(calls[2][0].requestBody.name).toMatch(/^112-6147345-5547445-label-/);
      expect(calls[3][0].requestBody.name).toMatch(/^112-6147345-5547445-packing-slip-/);
    });

    it("captures partial Drive error when packing-slip upload fails (label still recorded)", async () => {
      filesListMock.mockResolvedValue({ data: { files: [] } });
      filesCreateMock
        .mockResolvedValueOnce({ data: { id: "labels-folder-id" } })
        .mockResolvedValueOnce({ data: { id: "shopify-folder-id" } })
        .mockResolvedValueOnce({
          data: { id: "label-ok", webViewLink: "https://drive/label" },
        })
        .mockRejectedValueOnce(new Error("rate limit on slip"));

      const { persistLabelArtifacts } = await import("../shipping-artifacts");
      const result = await persistLabelArtifacts({
        orderNumber: "1052",
        source: "shopify",
        trackingNumber: null,
        fullPdf: Buffer.from("ignored"),
        labelOnlyPdf: Buffer.from("L"),
        packingSlipOnlyPdf: Buffer.from("S"),
      });
      expect(result.label?.fileId).toBe("label-ok");
      expect(result.packingSlip).toBeNull();
      expect(result.driveError).toMatch(/packing-slip upload/);
    });

    it("never throws when Drive client throws unexpectedly — returns a record with driveError", async () => {
      filesListMock.mockRejectedValue(new Error("auth failed"));
      filesCreateMock.mockRejectedValue(new Error("auth failed"));
      const { persistLabelArtifacts } = await import("../shipping-artifacts");
      const result = await persistLabelArtifacts({
        orderNumber: "1099",
        source: "shopify",
        trackingNumber: null,
        fullPdf: Buffer.from("X"),
        labelOnlyPdf: Buffer.from("X"),
      });
      expect(result.label).toBeNull();
      expect(result.driveError).toMatch(/folder ensure|auth failed/);
    });
  });

  describe("attachSlackPermalink + getShippingArtifact", () => {
    it("merges the Slack permalink into the existing KV record", async () => {
      const { persistLabelArtifacts, attachSlackPermalink, getShippingArtifact } =
        await import("../shipping-artifacts");
      // No env → null artifacts but KV row is still written.
      await persistLabelArtifacts({
        orderNumber: "1100",
        source: "shopify",
        trackingNumber: "T",
        fullPdf: Buffer.from("X"),
      });
      await attachSlackPermalink({
        source: "shopify",
        orderNumber: "1100",
        slackPermalink: "https://slack.com/archives/C/p123",
      });
      const r = await getShippingArtifact("shopify", "1100");
      expect(r?.slackPermalink).toBe("https://slack.com/archives/C/p123");
      expect(r?.orderNumber).toBe("1100");
    });

    it("creates a bare record when Slack permalink arrives before persist (defensive)", async () => {
      const { attachSlackPermalink, getShippingArtifact } = await import(
        "../shipping-artifacts"
      );
      await attachSlackPermalink({
        source: "amazon",
        orderNumber: "112-9999999-9999999",
        slackPermalink: "https://slack/p",
      });
      const r = await getShippingArtifact("amazon", "112-9999999-9999999");
      expect(r?.slackPermalink).toBe("https://slack/p");
      expect(r?.label).toBeNull();
      expect(r?.driveError).toMatch(/no Drive write/i);
    });
  });

  describe("bulkLookupArtifacts", () => {
    it("returns a map keyed by orderNumber, finds records across sources", async () => {
      const { persistLabelArtifacts, bulkLookupArtifacts } = await import(
        "../shipping-artifacts"
      );
      await persistLabelArtifacts({
        orderNumber: "112-1111111-1111111",
        source: "amazon",
        fullPdf: Buffer.from("X"),
      });
      await persistLabelArtifacts({
        orderNumber: "1052",
        source: "shopify",
        fullPdf: Buffer.from("X"),
      });
      const map = await bulkLookupArtifacts([
        { orderNumber: "112-1111111-1111111" },
        { orderNumber: "1052" },
        { orderNumber: "ghost-not-stored" },
      ]);
      expect(map.size).toBe(2);
      expect(map.get("112-1111111-1111111")?.source).toBe("amazon");
      expect(map.get("1052")?.source).toBe("shopify");
      expect(map.get("ghost-not-stored")).toBeUndefined();
    });
  });

  describe("splitLabelAndPackingSlip", () => {
    it("returns nulls for unparseable bytes (never throws)", async () => {
      const { splitLabelAndPackingSlip } = await import(
        "../shipping-artifacts"
      );
      const out = await splitLabelAndPackingSlip(Buffer.from("not-a-pdf"));
      expect(out.labelOnly).toBeNull();
      expect(out.packingSlipOnly).toBeNull();
    });
  });
});
