import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const createWorkpackMock = vi.fn();
const listWorkpacksMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/workpacks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/workpacks")>(
    "@/lib/ops/workpacks",
  );
  return {
    ...actual,
    createWorkpack: (input: unknown) => createWorkpackMock(input),
    listWorkpacks: (opts: unknown) => listWorkpacksMock(opts),
  };
});

import { GET, POST } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  createWorkpackMock.mockReset();
  listWorkpacksMock.mockReset();
});

function req(body?: unknown) {
  return new Request("http://localhost/api/ops/workpacks", {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/ops/workpacks", () => {
  it("auth-gates GET and POST", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req({}))).status).toBe(401);
  });

  it("GET lists queued workpacks", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    listWorkpacksMock.mockResolvedValueOnce([{ id: "wp_1", status: "queued" }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(listWorkpacksMock).toHaveBeenCalledWith({ limit: 50 });
  });

  it("POST validates and creates a queued workpack", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    createWorkpackMock.mockResolvedValueOnce({ id: "wp_1", status: "queued" });
    const res = await POST(
      req({
        intent: "prepare_codex_prompt",
        title: "Build this",
        sourceText: "Make a safe change",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workpack.id).toBe("wp_1");
  });

  it("POST rejects invalid workpack payloads before storage", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    const res = await POST(req({ intent: "send_email", title: "", sourceText: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_workpack");
    expect(createWorkpackMock).not.toHaveBeenCalled();
  });
});
