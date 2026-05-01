/**
 * Integration tests for the unified auto-ship route's artifact handling.
 *
 * Locked contracts (the whole point of this build):
 *   - Label buy success is NOT marked failed when Slack upload fails.
 *   - Drive artifact write happens AFTER label buy succeeds, BEFORE Slack
 *     upload (so the Slack message can include the Drive link).
 *   - Slack message includes the Drive link in `comment` when set.
 *   - createLabelForShipStationOrder is NEVER called twice for the same
 *     order in a single run, no matter what artifact-side errors happen.
 *   - When Slack upload fails, an alert is posted to #ops-alerts that
 *     includes the Drive label link.
 *   - Recent-labels response surfaces artifact links when present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ----- Auth bypass --------------------------------------------------------
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

// ----- ShipStation client mock --------------------------------------------
const createLabelMock = vi.fn();
const listOrdersMock = vi.fn();
const isShipStationConfiguredMock = vi.fn(() => true);
vi.mock("@/lib/ops/shipstation-client", () => ({
  createLabelForShipStationOrder: createLabelMock,
  listOrdersAwaitingShipment: listOrdersMock,
  isShipStationConfigured: () => isShipStationConfiguredMock(),
}));

// ----- Slack client mock --------------------------------------------------
const slackUploadMock = vi.fn();
vi.mock("@/lib/ops/slack-file-upload", () => ({
  uploadBufferToSlack: slackUploadMock,
}));

const postMessageMock = vi.fn(async () => ({ ok: true, ts: "fake-ts" }));
vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: postMessageMock,
}));

// Channel registry returns ops-alerts so warning posts have a target.
vi.mock("@/lib/ops/control-plane/channels", () => ({
  getChannel: (id: string) =>
    id === "ops-alerts"
      ? { id: "ops-alerts", name: "#ops-alerts", slackChannelId: "C0ATUGGUZL6" }
      : id === "ops-approvals"
        ? { id: "ops-approvals", name: "#ops-approvals", slackChannelId: "C0ATWJDHS74" }
        : id === "operations"
          ? { id: "operations", name: "#operations", slackChannelId: "C0AR75M63Q9" }
          : null,
  slackChannelRef: (id: string) => {
    if (id === "ops-alerts") return "C0ATUGGUZL6";
    if (id === "ops-approvals") return "C0ATWJDHS74";
    if (id === "operations") return "C0AR75M63Q9";
    return `#${id}`;
  },
}));

// ----- Audit + run-id mocks -----------------------------------------------
const auditAppendMock = vi.fn(async () => undefined);
const auditMirrorMock = vi.fn(async () => undefined);
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ append: auditAppendMock }),
}));
vi.mock("@/lib/ops/control-plane/slack", () => ({
  auditSurface: () => ({ mirror: auditMirrorMock }),
}));

// ----- Vercel KV mock -----------------------------------------------------
const kvStore = new Map<string, string>();
vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (k: string) => {
      const v = kvStore.get(k);
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }),
    set: vi.fn(async (k: string, v: string | object) => {
      kvStore.set(k, typeof v === "string" ? v : JSON.stringify(v));
      return "OK";
    }),
  },
}));

// ----- shipping-artifacts module (real, but Drive faked via spy) ----------
const persistMock = vi.fn();
const splitMock = vi.fn();
const attachSlackMock = vi.fn(async () => undefined);
vi.mock("@/lib/ops/shipping-artifacts", () => ({
  persistLabelArtifacts: persistMock,
  splitLabelAndPackingSlip: splitMock,
  attachSlackPermalink: attachSlackMock,
}));

// ----- helpers ------------------------------------------------------------

function fakeOrder() {
  return {
    orderId: 88001,
    orderNumber: "112-6147345-5547445",
    advancedOptions: { source: "Amazon" },
    shipTo: {
      name: "Smoke Tester",
      street1: "123 Smoke Lane",
      city: "Ashford",
      state: "WA",
      postalCode: "98304",
      country: "US",
      phone: null,
      residential: true,
    },
    items: [{ sku: "USG-FBM-002", quantity: 1, name: "2-pack" }],
  };
}

function fakeLabel() {
  // 1×1 fake base64 stub. The route base64-decodes; pdf-lib parsing is
  // bypassed because we mock splitLabelAndPackingSlip below.
  const fakeBase64 = Buffer.from("FAKEPDFBYTES").toString("base64");
  return {
    ok: true as const,
    label: {
      carrier: "ups",
      service: "UPS Ground Saver",
      serviceCode: "ups_ground_saver",
      trackingNumber: "1ZJ74F69YW11720505",
      labelUrl: `data:application/pdf;base64,${fakeBase64}`,
      cost: 11.3,
      shipmentId: 9999,
    },
    markShippedOk: true,
  };
}

function buildReq(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/ops/shipping/auto-ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  kvStore.clear();
  vi.clearAllMocks();
  isShipStationConfiguredMock.mockReturnValue(true);
  process.env.AUTO_SHIP_ENABLED = "true";
  // Default: split returns valid bytes, persist returns happy artifact.
  splitMock.mockResolvedValue({
    labelOnly: Buffer.from("LABEL"),
    packingSlipOnly: Buffer.from("SLIP"),
  });
  persistMock.mockResolvedValue({
    orderNumber: "112-6147345-5547445",
    source: "amazon",
    trackingNumber: "1ZJ74F69YW11720505",
    label: { fileId: "drive-label-id", webViewLink: "https://drive/label" },
    packingSlip: {
      fileId: "drive-slip-id",
      webViewLink: "https://drive/slip",
    },
    slackPermalink: null,
    persistedAt: new Date().toISOString(),
    driveError: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ops/shipping/auto-ship — artifact handling", () => {
  it("happy path: persists to Drive, posts to Slack with Drive link, returns artifact urls", async () => {
    listOrdersMock.mockResolvedValue({ ok: true, orders: [fakeOrder()] });
    createLabelMock.mockResolvedValue(fakeLabel());
    slackUploadMock.mockResolvedValue({
      ok: true,
      fileId: "F123",
      permalink: "https://slack.com/archives/C/p999",
    });

    const { POST } = await import("../route");
    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    const r = body.results[0];
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeFalsy();
    expect(r.trackingNumber).toBe("1ZJ74F69YW11720505");
    expect(r.labelDriveLink).toBe("https://drive/label");
    expect(r.packingSlipDriveLink).toBe("https://drive/slip");
    expect(r.slackPermalink).toBe("https://slack.com/archives/C/p999");
    expect(r.driveError).toBeNull();

    // Drive write happened with the right inputs (label buy result).
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: "112-6147345-5547445",
        source: "amazon",
        trackingNumber: "1ZJ74F69YW11720505",
      }),
    );
    // Slack upload comment includes Drive link (our explicit contract).
    const slackArgs = slackUploadMock.mock.calls[0][0];
    expect(slackArgs.filename).toBe("label-112-6147345-5547445.pdf");
    expect(slackArgs.comment).toContain("Drive: label PDF");
    expect(slackArgs.comment).toContain("https://drive/label");

    // Permalink got attached back to the artifact record.
    expect(attachSlackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "amazon",
        orderNumber: "112-6147345-5547445",
        slackPermalink: "https://slack.com/archives/C/p999",
      }),
    );

    // Critical: the label was bought EXACTLY ONCE. No retry on artifact code.
    expect(createLabelMock).toHaveBeenCalledTimes(1);
  });

  it("Slack upload failure: result still ok=true, posts warning to #ops-alerts with Drive link", async () => {
    listOrdersMock.mockResolvedValue({ ok: true, orders: [fakeOrder()] });
    createLabelMock.mockResolvedValue(fakeLabel());
    slackUploadMock.mockResolvedValue({
      ok: false,
      error: "channel_not_found",
    });

    const { POST } = await import("../route");
    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<Record<string, unknown>>; shipped: number; failed: number };
    const r = body.results[0];
    // KEY INVARIANT: the label was bought, so the run is a success.
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeFalsy();
    expect(body.shipped).toBe(1);
    expect(body.failed).toBe(0);
    // The artifact links survive the Slack failure.
    expect(r.labelDriveLink).toBe("https://drive/label");
    expect(r.slackPermalink).toBeUndefined();

    // No second label buy ever.
    expect(createLabelMock).toHaveBeenCalledTimes(1);

    // A warning got posted to #ops-alerts with the Drive link inline.
    const allCalls = postMessageMock.mock.calls as unknown as Array<
      [{ channel: string; text: string }]
    >;
    const alertCalls = allCalls.filter((c) => c[0].channel === "C0ATUGGUZL6");
    expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    const alertText = alertCalls[0][0].text;
    expect(alertText).toContain("Slack file upload FAILED");
    expect(alertText).toContain("112-6147345-5547445");
    expect(alertText).toContain("https://drive/label");
  });

  it("Drive failure does not block Slack upload or fail the result", async () => {
    listOrdersMock.mockResolvedValue({ ok: true, orders: [fakeOrder()] });
    createLabelMock.mockResolvedValue(fakeLabel());
    persistMock.mockResolvedValue({
      orderNumber: "112-6147345-5547445",
      source: "amazon",
      trackingNumber: "1ZJ74F69YW11720505",
      label: null,
      packingSlip: null,
      slackPermalink: null,
      persistedAt: new Date().toISOString(),
      driveError: "GMAIL_OAUTH_REFRESH_TOKEN missing",
    });
    slackUploadMock.mockResolvedValue({
      ok: true,
      fileId: "F999",
      permalink: "https://slack/p",
    });

    const { POST } = await import("../route");
    const res = await POST(buildReq());
    const body = (await res.json()) as { results: Array<Record<string, unknown>>; shipped: number };
    expect(body.shipped).toBe(1);
    const r = body.results[0];
    expect(r.ok).toBe(true);
    expect(r.labelDriveLink).toBeNull();
    expect(r.driveError).toMatch(/GMAIL_OAUTH/);
    expect(r.slackPermalink).toBe("https://slack/p");
    expect(createLabelMock).toHaveBeenCalledTimes(1);
  });

  it("artifact module thrown exception is caught — label buy still succeeds", async () => {
    listOrdersMock.mockResolvedValue({ ok: true, orders: [fakeOrder()] });
    createLabelMock.mockResolvedValue(fakeLabel());
    persistMock.mockRejectedValue(new Error("unexpected drive crash"));
    slackUploadMock.mockResolvedValue({ ok: true, permalink: "https://slack/p" });

    const { POST } = await import("../route");
    const res = await POST(buildReq());
    const body = (await res.json()) as { results: Array<Record<string, unknown>>; shipped: number; failed: number };
    expect(body.shipped).toBe(1);
    expect(body.failed).toBe(0);
    const r = body.results[0];
    expect(r.ok).toBe(true);
    expect(r.driveError).toMatch(/unexpected drive crash/);
    expect(createLabelMock).toHaveBeenCalledTimes(1);
  });

  it("dryRun: never buys label, never persists, never uploads", async () => {
    listOrdersMock.mockResolvedValue({ ok: true, orders: [fakeOrder()] });
    const { POST } = await import("../route");
    const res = await POST(buildReq({ dryRun: true }));
    const body = (await res.json()) as { results: Array<Record<string, unknown>>; shipped: number };
    expect(body.shipped).toBe(0);
    const r = body.results[0];
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toBe("dryRun");
    expect(createLabelMock).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
    expect(slackUploadMock).not.toHaveBeenCalled();
  });
});
