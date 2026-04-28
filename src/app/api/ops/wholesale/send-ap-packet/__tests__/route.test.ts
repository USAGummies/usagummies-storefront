/**
 * Phase 35.f.3.c — POST /api/ops/wholesale/send-ap-packet route tests.
 *
 * Locked contracts:
 *   - 401 unauthorized
 *   - 400 missing both flowId and state
 *   - 400 non-JSON body
 *   - 404 flowId provided but state not in KV
 *   - 422 packet-not-sendable (prospect missing, orderLines empty,
 *     bundle Drive IDs missing in env)
 *   - 500 KV read failure
 *   - 200 happy path with gmailMessageId + recipient + flowId
 *   - inline state takes priority over flowId (override-friendly)
 *   - invoiceContext threaded through to the underlying helper
 *   - middleware allowlist defense
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const sendWholesaleApPacketMock = vi.fn();
const loadOnboardingStateMock = vi.fn();

vi.mock("@/lib/wholesale/onboarding-dispatch-prod", () => ({
  sendWholesaleApPacket: (...a: unknown[]) =>
    sendWholesaleApPacketMock(...a),
}));

vi.mock("@/lib/wholesale/onboarding-store", () => ({
  loadOnboardingState: (...a: unknown[]) => loadOnboardingStateMock(...a),
}));

import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  sendWholesaleApPacketMock.mockReset();
  loadOnboardingStateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_send_001",
    currentStep: "ap-email-sent",
    stepsCompleted: ["info"],
    orderLines: [
      {
        tier: "B3",
        unitCount: 15,
        unitLabel: "Master carton + buyer freight",
        bags: 540,
        bagPriceUsd: 3.25,
        subtotalUsd: 1755.0,
        freightMode: "buyer-paid",
        invoiceLabel: "B3",
        customFreightRequired: false,
      },
    ],
    timestamps: {},
    prospect: {
      companyName: "Thanksgiving Point",
      contactName: "Mike",
      contactEmail: "mhippler@thanksgivingpoint.org",
    },
    paymentPath: "accounts-payable",
    ...overrides,
  };
}

function buildReq(body: unknown): Request {
  return new Request(
    "http://localhost/api/ops/wholesale/send-ap-packet",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

interface SendResp {
  ok: boolean;
  gmailMessageId?: string;
  to?: string;
  flowId?: string;
  error?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Auth + body
// ---------------------------------------------------------------------------

describe("POST /send-ap-packet — auth + body", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    const { POST } = await import("../route");
    const res = await POST(buildReq({ state: buildState() }));
    expect(res.status).toBe(401);
  });

  it("400 on non-JSON body", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/ops/wholesale/send-ap-packet", {
        method: "POST",
        body: "not json {",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when neither flowId nor state provided", async () => {
    const { POST } = await import("../route");
    const res = await POST(buildReq({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as SendResp;
    expect(body.error).toMatch(/flowId.*OR.*state/);
  });
});

// ---------------------------------------------------------------------------
// State resolution
// ---------------------------------------------------------------------------

describe("POST /send-ap-packet — state resolution", () => {
  it("inline state used when provided (no KV read)", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-1",
    });
    const { POST } = await import("../route");
    await POST(buildReq({ state: buildState() }));
    expect(loadOnboardingStateMock).not.toHaveBeenCalled();
    expect(sendWholesaleApPacketMock).toHaveBeenCalledTimes(1);
  });

  it("loads state from KV when flowId provided + state not inlined", async () => {
    loadOnboardingStateMock.mockResolvedValue(buildState({ flowId: "wf_x" }));
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-2",
    });
    const { POST } = await import("../route");
    await POST(buildReq({ flowId: "wf_x" }));
    expect(loadOnboardingStateMock).toHaveBeenCalledWith("wf_x");
    expect(sendWholesaleApPacketMock).toHaveBeenCalledTimes(1);
  });

  it("404 when flowId provided but state missing in KV", async () => {
    loadOnboardingStateMock.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(buildReq({ flowId: "wf_missing" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as SendResp;
    expect(body.error).toMatch(/wf_missing not found/);
  });

  it("500 when KV read throws", async () => {
    loadOnboardingStateMock.mockRejectedValue(new Error("kv down"));
    const { POST } = await import("../route");
    const res = await POST(buildReq({ flowId: "wf_x" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as SendResp;
    expect(body.error).toBe("kv_read_failed");
  });
});

// ---------------------------------------------------------------------------
// Send result handling
// ---------------------------------------------------------------------------

describe("POST /send-ap-packet — send result", () => {
  it("200 happy path with gmailMessageId, to, flowId", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-success",
    });
    const { POST } = await import("../route");
    const res = await POST(buildReq({ state: buildState() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SendResp;
    expect(body.ok).toBe(true);
    expect(body.gmailMessageId).toBe("gm-success");
    expect(body.to).toBe("mhippler@thanksgivingpoint.org");
    expect(body.flowId).toBe("wf_send_001");
  });

  it("uses apEmail recipient when AP path + apEmail captured", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-ap",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildReq({
        state: buildState({
          paymentPath: "accounts-payable",
          apInfo: { apEmail: "ap@thanksgivingpoint.org" },
        }),
      }),
    );
    const body = (await res.json()) as SendResp;
    expect(body.to).toBe("ap@thanksgivingpoint.org");
  });

  it("422 when packet not sendable (prospect missing)", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: false,
      error:
        "state.prospect missing — no recipient email available",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildReq({ state: buildState({ prospect: undefined }) }),
    );
    expect(res.status).toBe(422);
  });

  it("422 when bundle Drive IDs not configured in env", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: false,
      error:
        "wholesale-ap bundle not configured — set WHOLESALE_AP_PACKET_NCS001_DRIVE_ID and WHOLESALE_AP_PACKET_CIF001_DRIVE_ID on Vercel",
    });
    const { POST } = await import("../route");
    const res = await POST(buildReq({ state: buildState() }));
    expect(res.status).toBe(422);
  });

  it("500 when underlying send fails on Gmail / Drive infra", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: false,
      error: "Gmail send failed: rate limited",
    });
    const { POST } = await import("../route");
    const res = await POST(buildReq({ state: buildState() }));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// invoiceContext passthrough
// ---------------------------------------------------------------------------

describe("POST /send-ap-packet — invoiceContext", () => {
  it("threads invoiceContext into the underlying send helper", async () => {
    sendWholesaleApPacketMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-x",
    });
    const { POST } = await import("../route");
    await POST(
      buildReq({
        state: buildState(),
        invoiceContext: {
          invoiceNumber: "1755",
          invoiceDriveFileId: "drive-id-inv-1755",
          totalUsdOverride: 1755,
          personalNote: "Per our call today.",
        },
      }),
    );
    const call = sendWholesaleApPacketMock.mock.calls[0][0];
    expect(call.invoiceContext.invoiceNumber).toBe("1755");
    expect(call.invoiceContext.invoiceDriveFileId).toBe(
      "drive-id-inv-1755",
    );
    expect(call.invoiceContext.totalUsdOverride).toBe(1755);
    expect(call.invoiceContext.personalNote).toBe("Per our call today.");
  });
});

// ---------------------------------------------------------------------------
// Middleware allowlist defense
// ---------------------------------------------------------------------------

describe("middleware allowlist defense", () => {
  it("the route's path prefix is registered in middleware.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain("/api/ops/wholesale/send-ap-packet");
  });
});
