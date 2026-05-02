import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const getWorkpackMock = vi.fn();
const updateWorkpackMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/workpacks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/workpacks")>(
    "@/lib/ops/workpacks",
  );
  return {
    ...actual,
    getWorkpack: (id: string) => getWorkpackMock(id),
    updateWorkpack: (id: string, patch: unknown) => updateWorkpackMock(id, patch),
  };
});

import { WorkpackUpdateError } from "@/lib/ops/workpacks";
import { GET, PATCH } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  getWorkpackMock.mockReset();
  updateWorkpackMock.mockReset();
});

function req(body?: unknown) {
  return new Request("https://www.usagummies.com/api/ops/workpacks/wp_1", {
    method: body === undefined ? "GET" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id = "wp_1") {
  return { params: Promise.resolve({ id }) };
}

describe("/api/ops/workpacks/[id]", () => {
  it("auth-gates GET and PATCH", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    expect((await GET(req(), ctx())).status).toBe(401);
    expect((await PATCH(req({ status: "running" }), ctx())).status).toBe(401);
  });

  it("GET returns one workpack or 404", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce({ id: "wp_1", status: "queued" });
    expect((await GET(req(), ctx())).status).toBe(200);

    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce(null);
    const missing = await GET(req(), ctx("missing"));
    expect(missing.status).toBe(404);
  });

  it("PATCH updates status/result metadata", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "needs_review",
      resultSummary: "Done",
    });
    const res = await PATCH(
      req({ status: "needs_review", resultSummary: "Done" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(updateWorkpackMock).toHaveBeenCalledWith("wp_1", {
      status: "needs_review",
      resultSummary: "Done",
    });
  });

  it("PATCH maps update errors to stable statuses", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    updateWorkpackMock.mockRejectedValueOnce(
      new WorkpackUpdateError("invalid_links", "bad links"),
    );
    const res = await PATCH(req({ resultLinks: ["slack://x"] }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_links");
  });

  it("PATCH rejects invalid json", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    const res = await PATCH(
      new Request("https://www.usagummies.com/api/ops/workpacks/wp_1", {
        method: "PATCH",
        body: "{",
      }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });
});
