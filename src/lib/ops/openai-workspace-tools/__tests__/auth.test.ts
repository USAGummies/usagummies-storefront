import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => false),
}));

import * as authModule from "@/lib/ops/abra-auth";
import {
  hasOpenAIWorkspaceBearer,
  isOpenAIWorkspaceAuthorized,
  OPENAI_WORKSPACE_CONNECTOR_SECRET,
} from "../auth";

const mockedOpsAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;
const original = process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET];

function req(auth?: string): Request {
  return new Request("http://localhost/api/ops/openai-workspace-tools/mcp", {
    headers: auth ? { authorization: auth } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedOpsAuth.mockResolvedValue(false);
  delete process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET];
});

afterEach(() => {
  if (original === undefined) delete process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET];
  else process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET] = original;
});

describe("OpenAI workspace connector auth", () => {
  it("fails closed when the connector secret is unset", () => {
    expect(hasOpenAIWorkspaceBearer(req("Bearer secret"))).toBe(false);
  });

  it("accepts a matching bearer token", () => {
    process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET] = "workspace-secret";
    expect(hasOpenAIWorkspaceBearer(req("Bearer workspace-secret"))).toBe(true);
  });

  it("rejects missing, malformed, and mismatched bearer tokens", () => {
    process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET] = "workspace-secret";
    expect(hasOpenAIWorkspaceBearer(req())).toBe(false);
    expect(hasOpenAIWorkspaceBearer(req("Basic workspace-secret"))).toBe(false);
    expect(hasOpenAIWorkspaceBearer(req("Bearer wrong"))).toBe(false);
  });

  it("accepts existing ops auth without requiring the connector secret", async () => {
    mockedOpsAuth.mockResolvedValueOnce(true);
    await expect(isOpenAIWorkspaceAuthorized(req())).resolves.toBe(true);
  });

  it("falls back to connector bearer when ops auth rejects", async () => {
    process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET] = "workspace-secret";
    await expect(
      isOpenAIWorkspaceAuthorized(req("Bearer workspace-secret")),
    ).resolves.toBe(true);
  });

  it("rejects when both ops auth and connector bearer reject", async () => {
    process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET] = "workspace-secret";
    await expect(isOpenAIWorkspaceAuthorized(req("Bearer nope"))).resolves.toBe(
      false,
    );
  });
});
