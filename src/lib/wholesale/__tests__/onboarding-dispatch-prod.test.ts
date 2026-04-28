/**
 * Phase 35.f.3.b — production deps factory tests.
 *
 * Strategy: mock the underlying helpers (`upsertContactByEmail`,
 * `createDeal`, `updateDealStage`, `appendWholesaleInquiry`,
 * `postMessage`, `@vercel/kv`, `fetch`) and exercise the factory's
 * adaptation logic.
 *
 * Locked contracts:
 *   - Factory returns a complete DispatchDeps (every key present).
 *   - HubSpot handlers route to the correct underlying helper.
 *   - HubSpot handlers return ok:false when isHubSpotConfigured() is false.
 *   - Slack handler posts to #financials (channel id C0AKG9FSC2J)
 *     and includes the captured order lines in the message.
 *   - kvArchiveInquiry maps OnboardingState → WholesaleInquiryRecord
 *     fields and calls appendWholesaleInquiry.
 *   - kvWriteOrderCaptured calls writeOrderCapturedSnapshot.
 *   - apPacketSend + qboStageVendorMasterApproval return ok:false
 *     with `phase 35.f.3.c TODO` errors (clear next-step markers).
 *   - auditFlowComplete writes to `wholesale:audit:flow-complete:<id>`.
 *   - Each handler converts thrown exceptions into ok:false outcomes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingState } from "../onboarding-flow";

// ---- Mock all the upstream helpers ----------------------------------------

const upsertContactByEmailMock = vi.fn();
const createDealMock = vi.fn();
const updateDealStageMock = vi.fn();
const isHubSpotConfiguredMock = vi.fn();
vi.mock("@/lib/ops/hubspot-client", () => ({
  upsertContactByEmail: (...a: unknown[]) => upsertContactByEmailMock(...a),
  createDeal: (...a: unknown[]) => createDealMock(...a),
  updateDealStage: (...a: unknown[]) => updateDealStageMock(...a),
  isHubSpotConfigured: () => isHubSpotConfiguredMock(),
  HUBSPOT: {},
}));

const postMessageMock = vi.fn();
vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: (...a: unknown[]) => postMessageMock(...a),
}));

const appendWholesaleInquiryMock = vi.fn();
vi.mock("../inquiries", () => ({
  appendWholesaleInquiry: (...a: unknown[]) =>
    appendWholesaleInquiryMock(...a),
}));

const writeOrderCapturedSnapshotMock = vi.fn();
vi.mock("../onboarding-store", () => ({
  writeOrderCapturedSnapshot: (...a: unknown[]) =>
    writeOrderCapturedSnapshotMock(...a),
}));

const kvStore = new Map<string, unknown>();
vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      kvStore.set(key, value);
    }),
  },
}));

import {
  __INTERNAL,
  buildProdDispatchDeps,
} from "../onboarding-dispatch-prod";

beforeEach(() => {
  upsertContactByEmailMock.mockReset();
  createDealMock.mockReset();
  updateDealStageMock.mockReset();
  isHubSpotConfiguredMock.mockReset();
  isHubSpotConfiguredMock.mockReturnValue(true);
  postMessageMock.mockReset();
  appendWholesaleInquiryMock.mockReset();
  writeOrderCapturedSnapshotMock.mockReset();
  kvStore.clear();
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "fake-token";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
});

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_prod_001",
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: {},
    prospect: {
      companyName: "Acme",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    },
    ...overrides,
  };
}

describe("buildProdDispatchDeps — shape", () => {
  it("returns a DispatchDeps with every required handler", () => {
    const deps = buildProdDispatchDeps();
    expect(typeof deps.hubspotUpsertContact).toBe("function");
    expect(typeof deps.hubspotCreateDeal).toBe("function");
    expect(typeof deps.hubspotAdvanceStage).toBe("function");
    expect(typeof deps.hubspotSetOnboardingComplete).toBe("function");
    expect(typeof deps.kvArchiveInquiry).toBe("function");
    expect(typeof deps.kvWriteOrderCaptured).toBe("function");
    expect(typeof deps.slackPostFinancialsNotif).toBe("function");
    expect(typeof deps.apPacketSend).toBe("function");
    expect(typeof deps.qboStageVendorMasterApproval).toBe("function");
    expect(typeof deps.auditFlowComplete).toBe("function");
  });
});

describe("hubspotUpsertContact", () => {
  it("routes to upsertContactByEmail and returns contactId", async () => {
    upsertContactByEmailMock.mockResolvedValue({ id: "C-9", created: false });
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotUpsertContact({
      email: "x@y.com",
      firstname: "X",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contactId).toBe("C-9");
  });

  it("ok:false when isHubSpotConfigured is false", async () => {
    isHubSpotConfiguredMock.mockReturnValue(false);
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotUpsertContact({ email: "x@y.com" });
    expect(r.ok).toBe(false);
  });

  it("ok:false when underlying helper returns null", async () => {
    upsertContactByEmailMock.mockResolvedValue(null);
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotUpsertContact({ email: "x@y.com" });
    expect(r.ok).toBe(false);
  });

  it("converts thrown exception to ok:false", async () => {
    upsertContactByEmailMock.mockRejectedValue(new Error("network"));
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotUpsertContact({ email: "x@y.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("network");
  });
});

describe("hubspotCreateDeal", () => {
  it("routes to createDeal with dealname, dealstage", async () => {
    createDealMock.mockResolvedValue("D-22");
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotCreateDeal({
      dealName: "Acme Wholesale",
      stage: "STAGE_LEAD",
      properties: { wholesale_flow_id: "wf_x" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dealId).toBe("D-22");
    expect(createDealMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dealname: "Acme Wholesale",
        dealstage: "STAGE_LEAD",
      }),
    );
  });

  it("ok:false when underlying helper returns null", async () => {
    createDealMock.mockResolvedValue(null);
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotCreateDeal({
      dealName: "X",
      stage: "Y",
    });
    expect(r.ok).toBe(false);
  });
});

describe("hubspotAdvanceStage", () => {
  it("routes to updateDealStage", async () => {
    updateDealStageMock.mockResolvedValue("pending_ap_approval");
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotAdvanceStage({
      dealId: "D-1",
      stage: "pending_ap_approval",
    });
    expect(r.ok).toBe(true);
    expect(updateDealStageMock).toHaveBeenCalledWith(
      "D-1",
      "pending_ap_approval",
    );
  });

  it("ok:false when updateDealStage returns null", async () => {
    updateDealStageMock.mockResolvedValue(null);
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotAdvanceStage({ dealId: "D-1", stage: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("hubspotSetOnboardingComplete", () => {
  it("PATCHes the deal property via fetch", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        ({ ok: true, status: 200 }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotSetOnboardingComplete({
      dealId: "D-99",
      value: true,
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const args = fetchMock.mock.calls[0];
    const init = args[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.properties.wholesale_onboarding_complete).toBe("true");
    vi.unstubAllGlobals();
  });

  it("ok:false when token missing", async () => {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotSetOnboardingComplete({
      dealId: "D-1",
      value: true,
    });
    expect(r.ok).toBe(false);
  });

  it("ok:false on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: false, status: 500 }) as unknown as Response,
      ),
    );
    const deps = buildProdDispatchDeps();
    const r = await deps.hubspotSetOnboardingComplete({
      dealId: "D-1",
      value: false,
    });
    expect(r.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("kvArchiveInquiry", () => {
  it("calls appendWholesaleInquiry with mapped fields", async () => {
    appendWholesaleInquiryMock.mockResolvedValue({});
    const deps = buildProdDispatchDeps();
    const r = await deps.kvArchiveInquiry(
      buildState({
        storeType: "specialty-retail",
        shippingAddress: {
          street1: "1",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
          country: "US",
        },
      }),
    );
    expect(r.ok).toBe(true);
    const call = appendWholesaleInquiryMock.mock.calls[0][0];
    expect(call.email).toBe("jane@acme.test");
    expect(call.intent).toBe("wholesale");
    expect(call.source).toBe("wholesale-onboarding-flow");
    expect(call.location).toBe("Austin, TX");
    expect(call.interest).toBe("specialty-retail");
  });

  it("ok:false on thrown exception", async () => {
    appendWholesaleInquiryMock.mockRejectedValue(new Error("kv down"));
    const deps = buildProdDispatchDeps();
    const r = await deps.kvArchiveInquiry(buildState());
    expect(r.ok).toBe(false);
  });
});

describe("kvWriteOrderCaptured", () => {
  it("calls writeOrderCapturedSnapshot", async () => {
    writeOrderCapturedSnapshotMock.mockResolvedValue({
      flowId: "wf_x",
      capturedAt: "now",
      orderLines: [],
    });
    const deps = buildProdDispatchDeps();
    const r = await deps.kvWriteOrderCaptured(buildState());
    expect(r.ok).toBe(true);
    expect(writeOrderCapturedSnapshotMock).toHaveBeenCalledTimes(1);
  });
});

describe("slackPostFinancialsNotif", () => {
  it("posts to #financials with order lines + subtotal", async () => {
    postMessageMock.mockResolvedValue({ ok: true, ts: "111.22" });
    const deps = buildProdDispatchDeps();
    const r = await deps.slackPostFinancialsNotif(
      buildState({
        paymentPath: "accounts-payable",
        orderLines: [
          {
            tier: "B2",
            unitCount: 3,
            unitLabel: "Master carton (landed)",
            bags: 108,
            bagPriceUsd: 3.49,
            subtotalUsd: 376.92,
            freightMode: "landed",
            invoiceLabel: "B2 — Master carton (36 bags), landed",
            customFreightRequired: false,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ts).toBe("111.22");
    const call = postMessageMock.mock.calls[0][0];
    expect(call.channel).toBe(__INTERNAL.SLACK_FINANCIALS_CHANNEL_ID);
    expect(call.text).toContain("B2 × 3");
    expect(call.text).toContain("376.92");
    expect(call.text).toContain("accounts-payable");
  });

  it("ok:false when Slack returns ok:false", async () => {
    postMessageMock.mockResolvedValue({ ok: false, error: "channel not found" });
    const deps = buildProdDispatchDeps();
    const r = await deps.slackPostFinancialsNotif(buildState());
    expect(r.ok).toBe(false);
  });
});

describe("apPacketSend — TODO stub", () => {
  it("returns ok:false with phase 35.f.3.c TODO marker", async () => {
    const deps = buildProdDispatchDeps();
    const r = await deps.apPacketSend({
      state: buildState(),
      template: "wholesale-ap",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/phase 35\.f\.3\.c TODO/);
  });
});

describe("qboStageVendorMasterApproval — TODO stub", () => {
  it("returns ok:false with phase 35.f.3.c TODO marker", async () => {
    const deps = buildProdDispatchDeps();
    const r = await deps.qboStageVendorMasterApproval(buildState());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/phase 35\.f\.3\.c TODO/);
  });
});

describe("auditFlowComplete", () => {
  it("writes to wholesale:audit:flow-complete:<flowId>", async () => {
    const deps = buildProdDispatchDeps();
    const state = buildState({
      hubspotDealId: "D-99",
      qboCustomerApprovalId: "A-77",
      stepsCompleted: ["info", "store-type"],
    });
    const r = await deps.auditFlowComplete(state);
    expect(r.ok).toBe(true);
    const key = `${__INTERNAL.KV_AUDIT_PREFIX}wf_prod_001`;
    expect(kvStore.has(key)).toBe(true);
    const stored = JSON.parse(kvStore.get(key) as string);
    expect(stored.hubspotDealId).toBe("D-99");
    expect(stored.qboCustomerApprovalId).toBe("A-77");
    expect(stored.stepsCompleted).toEqual(["info", "store-type"]);
  });
});

describe("__INTERNAL constants", () => {
  it("exposes the canonical #financials channel id", () => {
    expect(__INTERNAL.SLACK_FINANCIALS_CHANNEL_ID).toBe("C0AKG9FSC2J");
  });
});
