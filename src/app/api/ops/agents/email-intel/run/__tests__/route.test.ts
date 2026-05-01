import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const auditAppendMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({
    append: auditAppendMock,
  }),
}));

import { GET, POST } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/agents/email-intel/run");
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedMock.mockResolvedValue(true);
  auditAppendMock.mockResolvedValue(undefined);
  delete process.env.EMAIL_INTEL_ENABLED;
});

describe("GET /api/ops/agents/email-intel/run", () => {
  it("401s unauthenticated requests", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(auditAppendMock).not.toHaveBeenCalled();
  });

  it("returns a readiness heartbeat and appends a fail-soft audit entry", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      runRecord: {
        agentId: string;
        outputState: string;
        approvalSlugsRequested: string[];
        nextHumanAction: string | null;
      };
      summary: { readiness: string; enabled: boolean; cronConfigured: boolean };
      status: { readiness: string; enabled: boolean };
      degraded: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.runRecord.agentId).toBe("email-agents-readiness");
    expect(body.runRecord.approvalSlugsRequested).toEqual([]);
    expect(body.summary.readiness).toBe(body.status.readiness);
    expect(body.summary.enabled).toBe(false);
    expect(body.degraded).toEqual([]);
    expect(auditAppendMock).toHaveBeenCalledTimes(1);
    const entry = auditAppendMock.mock.calls[0]?.[0] as {
      actorId: string;
      action: string;
      entityType: string;
      result: string;
      after: { readiness: string; enabled: boolean };
    };
    expect(entry.actorId).toBe("email-agents-readiness");
    expect(entry.action).toBe("system.read");
    expect(entry.entityType).toBe("agent-heartbeat-run");
    expect(entry.after.enabled).toBe(false);
  });

  it("surfaces a misconfigured enabled runner without invoking the real runner", async () => {
    process.env.EMAIL_INTEL_ENABLED = "true";
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runRecord: { outputState: string };
      summary: { readiness: string; enabled: boolean };
    };
    expect(body.summary.enabled).toBe(true);
    expect(body.summary.readiness).toBe("misconfigured");
    expect(body.runRecord.outputState).toBe("failed_degraded");
    const entry = auditAppendMock.mock.calls[0]?.[0] as {
      result: string;
      error?: { code?: string };
    };
    expect(entry.result).toBe("error");
    expect(entry.error?.code).toBe("email_agents_heartbeat_degraded");
  });

  it("does not fail the dry-run when audit append fails", async () => {
    auditAppendMock.mockRejectedValueOnce(new Error("kv down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; degraded: string[] };
    expect(body.ok).toBe(true);
    expect(body.degraded).toEqual(["audit-store: append failed (soft)"]);
  });

  it("does not import or call Gmail, HubSpot, Slack approvals, or the real email-intel runner", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/ops/agents/email-intel/run/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/control-plane\/approvals["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/control-plane\/slack/);
    expect(source).not.toMatch(/import\([^)]*fulfillment\/email-intel\/run/);
    expect(source).not.toMatch(/createGmailDraft|sendGmail|openApproval|requestApproval|postMessage/);
  });
});
