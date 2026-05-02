import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const listReceiptsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/slack-event-ledger", () => ({
  listSlackEventReceipts: (opts: unknown) => listReceiptsMock(opts),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  listReceiptsMock.mockReset();
});

function req(url = "https://www.usagummies.com/api/ops/slack/events/ledger") {
  return new Request(url);
}

describe("/api/ops/slack/events/ledger", () => {
  it("auth-gates the ledger", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns receipt totals", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    listReceiptsMock.mockResolvedValueOnce([
      { id: "1", recognized: true },
      { id: "2", recognized: false, skippedReason: "non-new-message" },
    ]);

    const res = await GET(
      req("https://www.usagummies.com/api/ops/slack/events/ledger?limit=10"),
    );
    expect(res.status).toBe(200);
    expect(listReceiptsMock).toHaveBeenCalledWith({ limit: 10 });
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.totals).toEqual({ recognized: 1, skipped: 1 });
  });
});
