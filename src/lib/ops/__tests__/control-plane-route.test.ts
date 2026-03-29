import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  listPurchaseOrders: vi.fn(),
  getPurchaseOrderByNumber: vi.fn(),
  getPurchaseOrderSummary: vi.fn(),
  shipPO: vi.fn(),
  markDelivered: vi.fn(),
  matchPayment: vi.fn(),
  closePO: vi.fn(),
  runEmailIntelligence: vi.fn(),
  readEmailIntelligenceSummary: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ops/abra-auth", () => ({ isAuthorized: mocked.isAuthorized }));
vi.mock("@/lib/ops/operator/po-pipeline", () => ({
  listPurchaseOrders: mocked.listPurchaseOrders,
  getPurchaseOrderByNumber: mocked.getPurchaseOrderByNumber,
  getPurchaseOrderSummary: mocked.getPurchaseOrderSummary,
  shipPO: mocked.shipPO,
  markDelivered: mocked.markDelivered,
  matchPayment: mocked.matchPayment,
  closePO: mocked.closePO,
}));
vi.mock("@/lib/ops/operator/email-intelligence", () => ({
  runEmailIntelligence: mocked.runEmailIntelligence,
  readEmailIntelligenceSummary: mocked.readEmailIntelligenceSummary,
}));

import { POST } from "@/app/api/ops/abra/control-plane/route";

describe("abra control-plane route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.isAuthorized.mockResolvedValue(true);
  });

  it("rejects unauthorized requests", async () => {
    mocked.isAuthorized.mockResolvedValue(false);

    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "po.summary" }),
    }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "Unauthorized" });
  });

  it("lists purchase orders with optional status filters", async () => {
    mocked.listPurchaseOrders.mockResolvedValue([{ po_number: "140812", status: "received" }]);

    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "po.list", statuses: ["received", "invalid"] }),
    }));

    expect(mocked.listPurchaseOrders).toHaveBeenCalledWith(["received"]);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      operation: "po.list",
      count: 1,
      rows: [{ po_number: "140812", status: "received" }],
    });
  });

  it("ships a PO via the transition operation", async () => {
    mocked.shipPO.mockResolvedValue({ po_number: "009180", status: "shipped", tracking_number: "123" });

    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "po.transition",
        transition: "ship",
        poNumber: "009180",
        carrier: "USPS",
        trackingNumber: "123",
        shippingCost: 12.5,
      }),
    }));

    expect(mocked.shipPO).toHaveBeenCalledWith({
      poNumber: "009180",
      carrier: "USPS",
      trackingNumber: "123",
      shippingCost: 12.5,
      estimatedDelivery: null,
      note: null,
    });
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      operation: "po.transition",
      transition: "ship",
      row: { po_number: "009180", status: "shipped", tracking_number: "123" },
    });
  });

  it("requires payment details for match_payment transitions", async () => {
    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "po.transition",
        transition: "match_payment",
        poNumber: "009180",
      }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "depositAmount and depositDate are required for match_payment",
    });
  });

  it("runs email intelligence with bounded options", async () => {
    mocked.runEmailIntelligence.mockResolvedValue({
      tasks: [],
      summary: { processed: 1, actionsTaken: 1, needsAttention: 0, replyTasks: 0, qboEmailTasks: 0, details: [] },
      postedSummary: true,
    });

    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "email_intelligence.run",
        messageIds: ["  abc  ", ""],
        includeRecent: false,
        forceSummary: true,
        reprocess: false,
      }),
    }));

    expect(mocked.runEmailIntelligence).toHaveBeenCalledWith({
      messageIds: ["abc"],
      includeRecent: false,
      forceSummary: true,
      reprocess: false,
    });
    expect(res.status).toBe(200);
  });

  it("returns the persisted email intelligence summary", async () => {
    mocked.readEmailIntelligenceSummary.mockResolvedValue({
      generatedAt: "2026-03-28T18:00:00.000Z",
      postedSummary: true,
      summary: { processed: 2, actionsTaken: 2, needsAttention: 0, replyTasks: 0, qboEmailTasks: 1, details: [] },
    });

    const res = await POST(new Request("https://example.com/api/ops/abra/control-plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "email_intelligence.summary" }),
    }));

    expect(mocked.readEmailIntelligenceSummary).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      operation: "email_intelligence.summary",
      summary: {
        generatedAt: "2026-03-28T18:00:00.000Z",
        postedSummary: true,
      },
    });
  });
});
