/**
 * POST /api/onboarding — customer-facing wholesale onboarding form.
 *
 * Locks the contract:
 *   - 500 when HubSpot isn't configured.
 *   - 400 with `missing` array when required fields are absent.
 *   - Pay-Now path requires only Tier-1 fields.
 *   - Invoice-Me path requires Tier-1 + Tier-2 fields, INCLUDING the
 *     new `shipAndPoAcknowledged` gate that confirms the customer
 *     understands submitting will ship product + produce a PO.
 *   - Both `termsAccepted` AND `shipAndPoAcknowledged` must be true
 *     on the Invoice-Me path. Either missing → 400.
 *   - Pay-Now submissions ignore the new gate (no need — there's no
 *     PO / invoice in that flow).
 *   - On success: HubSpot deal patched + onboarding note created;
 *     the note text records the customer's ship+PO acknowledgment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isHubSpotConfiguredMock = vi.fn();
const createNoteMock = vi.fn();
vi.mock("@/lib/ops/hubspot-client", () => ({
  isHubSpotConfigured: () => isHubSpotConfiguredMock(),
  createNote: (...a: unknown[]) => createNoteMock(...a),
  HUBSPOT: { ASSOC: { NOTE_TO_DEAL: 214 } },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  isHubSpotConfiguredMock.mockReset();
  isHubSpotConfiguredMock.mockReturnValue(true);
  createNoteMock.mockReset();
  createNoteMock.mockResolvedValue({ id: "note-123" });
  fetchMock.mockReset();
  // Default: deal exists with invoice_me payment method.
  // Build a plain stub response object that mimics what hsGet/hsPatch
  // touch — `ok`, `status`, `json()`. Avoids any subtle differences
  // between Node's Response and Vitest/Next.js polyfilled variants.
  const stubResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const isPatch = init?.method === "PATCH";
    if (isPatch) return stubResponse(200, {});
    if (u.includes("/D-PAYNOW")) {
      return stubResponse(200, {
        id: "D-PAYNOW",
        properties: {
          wholesale_payment_method: "pay_now",
          wholesale_onboarding_complete: "false",
          wholesale_payment_received: "true",
        },
      });
    }
    if (u.includes("/D1")) {
      return stubResponse(200, {
        id: "D1",
        properties: {
          wholesale_payment_method: "invoice_me",
          wholesale_onboarding_complete: "false",
          wholesale_payment_received: "false",
        },
      });
    }
    return stubResponse(404, { error: "not found" });
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "stub";
});

afterEach(() => vi.clearAllMocks());

const tier1 = {
  legalBusinessName: "Snow Leopard Ventures LLC",
  ein: "12-3456789",
  shipContactName: "Test Buyer",
  shipContactPhone: "555-0100",
};

const tier2Required = {
  apContactName: "AP Contact",
  apContactEmail: "ap@snowleopard.example",
  preferredPayment: "ach",
  termsAccepted: true,
  shipAndPoAcknowledged: true,
  signerName: "Authorized Signer",
  signerTitle: "Owner",
};

function postReq(body: unknown): Request {
  return new Request("https://www.usagummies.com/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding — Invoice-Me path", () => {
  it("returns 500 when HubSpot is not configured", async () => {
    isHubSpotConfiguredMock.mockReturnValueOnce(false);
    const { POST } = await import("../route");
    const res = await POST(postReq({ dealId: "D1", ...tier1, ...tier2Required }));
    expect(res.status).toBe(500);
  });

  it("400 + missing=['shipAndPoAcknowledged'] when only Net 10 ack is checked", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        dealId: "D1",
        ...tier1,
        ...tier2Required,
        shipAndPoAcknowledged: false,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("shipAndPoAcknowledged");
    expect(body.missing).not.toContain("termsAccepted");
  });

  it("400 + missing=['termsAccepted'] when only ship+PO ack is checked", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        dealId: "D1",
        ...tier1,
        ...tier2Required,
        termsAccepted: false,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("termsAccepted");
    expect(body.missing).not.toContain("shipAndPoAcknowledged");
  });

  it("400 with both missing when neither ack is checked", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        dealId: "D1",
        ...tier1,
        ...tier2Required,
        termsAccepted: false,
        shipAndPoAcknowledged: false,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("termsAccepted");
    expect(body.missing).toContain("shipAndPoAcknowledged");
  });

  it("200 when both acks are checked + all required fields filled", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({ dealId: "D1", ...tier1, ...tier2Required }),
    );
    expect(res.status).toBe(200);
    expect(createNoteMock).toHaveBeenCalledTimes(1);
    const noteHtml = createNoteMock.mock.calls[0][0]?.body ?? "";
    expect(noteHtml).toContain("Ship + PO acknowledged");
  });

  it("submitted payload's truthiness is strict: only `=== true` counts", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        dealId: "D1",
        ...tier1,
        ...tier2Required,
        // Common spoof attempts: string "true", number 1.
        shipAndPoAcknowledged: "true",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("shipAndPoAcknowledged");
  });
});

describe("POST /api/onboarding — Pay-Now path", () => {
  it("does NOT require shipAndPoAcknowledged on Pay-Now flow", async () => {
    const { POST } = await import("../route");
    const res = await POST(postReq({ dealId: "D-PAYNOW", ...tier1 }));
    expect(res.status).toBe(200);
    // Note still created; no Tier-2 acks involved.
    expect(createNoteMock).toHaveBeenCalledTimes(1);
    const noteHtml = createNoteMock.mock.calls[0][0]?.body ?? "";
    expect(noteHtml).toContain("Quick Ship (Pay Now)");
    // Pay-Now note specifically does NOT include the ship+PO line —
    // there's no PO in the Pay-Now flow, just a paid Shopify order.
    expect(noteHtml).not.toContain("Ship + PO acknowledged");
  });
});
