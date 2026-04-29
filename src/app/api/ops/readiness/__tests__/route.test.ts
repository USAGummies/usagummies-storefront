/**
 * Integration tests for GET /api/ops/readiness.
 *
 * Locked contracts:
 *   - 401 unauthenticated
 *   - 200 returns env fingerprint + smoke checklist + probes list
 *   - the response NEVER includes raw env values, only booleans
 *     (asserted by setting a recognizable secret in process.env and
 *     scanning the JSON response)
 *   - the route does NOT call fetch / KV / Drive / Gmail / Slack
 *     (no module imports beyond the pure helpers + isAuthorized)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

import * as authModule from "@/lib/ops/abra-auth";
const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

const ENV_KEYS = [
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GCP_GMAIL_OAUTH_CLIENT_ID",
  "GCP_GMAIL_OAUTH_CLIENT_SECRET",
  "GCP_GMAIL_OAUTH_REFRESH_TOKEN",
  "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
  "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
  "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "WHOLESALE_INQUIRY_SECRET",
  "OPENAI_WORKSPACE_CONNECTOR_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "CRON_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  mockedAuth.mockResolvedValue(true);
  vi.clearAllMocks();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

function buildReq(): Request {
  return new Request("http://localhost/api/ops/readiness", { method: "GET" });
}

describe("auth gate", () => {
  it("401 when unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });
});

describe("happy path", () => {
  it("returns env status + smoke checklist + probes list", async () => {
    process.env.CRON_SECRET = "test-cron-secret-value-must-not-leak-12345";
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      env: { rows: Array<{ key: string; status: string }> };
      smokeChecklist: Array<{ href: string }>;
      probes: Array<{ url: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.env.rows.length).toBeGreaterThan(0);
    expect(body.smokeChecklist.length).toBeGreaterThan(0);
    expect(body.probes.length).toBeGreaterThan(0);
    // Probes list contains the canonical safe-read endpoints.
    const urls = body.probes.map((p) => p.url);
    expect(urls).toContain("/api/ops/control-plane/health");
    expect(urls).toContain("/api/ops/ap-packets");
    expect(urls).toContain("/api/ops/locations/ingest");
    expect(urls).toContain("/api/ops/openai-workspace-tools/mcp");
  });
});

describe("env values never leak", () => {
  it("response NEVER contains the raw secret string", async () => {
    const SECRET = "super-secret-cron-value-do-not-leak-fffeeeddd111222333";
    process.env.CRON_SECRET = SECRET;
    process.env.GMAIL_OAUTH_REFRESH_TOKEN =
      "1//06ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_real_token_shape";
    process.env.WHOLESALE_INQUIRY_SECRET = "another-secret-that-should-stay-hidden-foo-bar-baz";
    process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET =
      "openai-workspace-secret-that-should-stay-hidden";
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("1//06ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
    expect(text).not.toContain("another-secret-that-should-stay-hidden");
    expect(text).not.toContain("openai-workspace-secret-that-should-stay-hidden");
    // Status is correctly reported as "ready" though.
    const body = JSON.parse(text) as {
      env: { rows: Array<{ key: string; status: string }> };
    };
    const cronRow = body.env.rows.find((r) => r.key === "CRON_SECRET");
    expect(cronRow?.status).toBe("ready");
    const connectorRow = body.env.rows.find(
      (r) => r.key === "OPENAI_WORKSPACE_CONNECTOR_SECRET",
    );
    expect(connectorRow?.status).toBe("ready");
  });
});

describe("env presence reflected accurately", () => {
  it("missing GOOGLE_DRIVE_UPLOAD_PARENT_ID is reported missing", async () => {
    process.env.CRON_SECRET = "x";
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as {
      env: { rows: Array<{ key: string; status: string }> };
    };
    const upload = body.env.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
    );
    expect(upload?.status).toBe("missing");
  });

  it("UPLOAD set + SHIPPING missing → SHIPPING shows as fallback", async () => {
    process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID = "real-folder-id";
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as {
      env: {
        rows: Array<{
          key: string;
          status: string;
          fallbackFrom?: string;
        }>;
      };
    };
    const ship = body.env.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    );
    expect(ship?.status).toBe("fallback");
    expect(ship?.fallbackFrom).toBe("GOOGLE_DRIVE_UPLOAD_PARENT_ID");
  });
});
