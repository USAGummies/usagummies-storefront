import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const postMessageMock = vi.fn();
const readFaireInvitesMock = vi.fn();
const readFaireFollowUpsMock = vi.fn();
const readPendingApprovalsMock = vi.fn();
const readApPacketsMock = vi.fn();
const readLocationDraftsMock = vi.fn();
const readAllAgingItemsMock = vi.fn();
const readAllChannelsLast7dMock = vi.fn();
const readWholesaleInquiriesMock = vi.fn();
const readDay1ProspectsMock = vi.fn();
const readSalesTourPlaybookMock = vi.fn();
const readSalesPipelineMock = vi.fn();
const readStaleBuyersMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: (params: unknown) => postMessageMock(params),
}));

vi.mock("@/lib/ops/sales-command-readers", () => ({
  readFaireInvites: () => readFaireInvitesMock(),
  readFaireFollowUps: (now: Date) => readFaireFollowUpsMock(now),
  readPendingApprovals: () => readPendingApprovalsMock(),
  readApPackets: () => readApPacketsMock(),
  readLocationDrafts: () => readLocationDraftsMock(),
  readAllAgingItems: (now: Date) => readAllAgingItemsMock(now),
  readWholesaleInquiries: () => readWholesaleInquiriesMock(),
  readDay1Prospects: () => readDay1ProspectsMock(),
  readSalesTourPlaybook: () => readSalesTourPlaybookMock(),
  readSalesPipeline: (now: Date) => readSalesPipelineMock(now),
  readStaleBuyers: (now: Date) => readStaleBuyersMock(now),
}));

vi.mock("@/lib/ops/revenue-kpi-readers", () => ({
  readAllChannelsLast7d: (now: Date) => readAllChannelsLast7dMock(now),
}));

function wired<T>(value: T) {
  return { status: "wired" as const, value };
}

function notWired(reason: string) {
  return { status: "not_wired" as const, reason };
}

function req(url = "https://www.usagummies.com/api/ops/slack/command-center?post=false", body?: unknown): Request {
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedMock.mockResolvedValue(true);
  postMessageMock.mockResolvedValue({ ok: true, channel: "C0ATWJDKLTU", ts: "1.234" });
  readFaireInvitesMock.mockResolvedValue(wired({
    needs_review: 1,
    approved: 0,
    sent: 0,
    rejected: 0,
    total: 1,
  }));
  readFaireFollowUpsMock.mockResolvedValue(wired({
    counts: { overdue: 0, due_soon: 1, not_due: 0, sent_total: 1 },
    actionable: [],
  }));
  readPendingApprovalsMock.mockResolvedValue(wired({
    total: 2,
    byTargetType: {},
    preview: [],
  }));
  readApPacketsMock.mockResolvedValue(wired({
    total: 0,
    ready_to_send: 0,
    action_required: 0,
    sent: 0,
  }));
  readLocationDraftsMock.mockResolvedValue(wired({
    needs_review: 0,
    accepted: 0,
    rejected: 0,
    total: 0,
  }));
  readAllAgingItemsMock.mockResolvedValue({ items: [], missing: [] });
  readAllChannelsLast7dMock.mockResolvedValue([
    {
      channel: "shopify",
      status: "wired",
      amountUsd: 100,
      source: { system: "shopify", retrievedAt: "2026-05-01T12:00:00.000Z" },
    },
  ]);
  readWholesaleInquiriesMock.mockResolvedValue(wired({ total: 3 }));
  readDay1ProspectsMock.mockResolvedValue(notWired("not wired in test"));
  readSalesTourPlaybookMock.mockResolvedValue(notWired("not wired in test"));
  readSalesPipelineMock.mockResolvedValue(notWired("not wired in test"));
  readStaleBuyersMock.mockResolvedValue(notWired("not wired in test"));
});

describe("/api/ops/slack/command-center", () => {
  it("401s before reading sources when unauthenticated", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(readFaireInvitesMock).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("returns a preview without posting when post=false", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; posted: boolean; message: { text: string; blocks: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.posted).toBe(false);
    expect(body.message.text).toContain("USA Gummies Command Center");
    expect(body.message.blocks.length).toBeGreaterThan(0);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("posts the command-center card to ops-daily by default", async () => {
    const { POST } = await import("../route");
    const res = await POST(req("https://www.usagummies.com/api/ops/slack/command-center", {}));
    expect(res.status).toBe(200);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const call = postMessageMock.mock.calls[0][0] as { channel: string; text: string; blocks: unknown[] };
    expect(call.channel).toBe("C0ATWJDKLTU");
    expect(call.text).toContain("USA Gummies Command Center");
    expect(JSON.stringify(call.blocks)).toContain("Open Sales Command");
  });
});
