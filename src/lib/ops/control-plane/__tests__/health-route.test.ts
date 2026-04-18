import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/ops/control-plane/health/route";
import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import {
  InMemoryCorrectionStore,
  InMemoryPauseSink,
  InMemoryViolationStore,
} from "../enforcement";
import {
  __resetStores,
  __setStoresForTest,
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "../stores";
import type { PolicyViolation } from "../types";

const PRIOR_CRON = process.env.CRON_SECRET;
const PRIOR_BOT = process.env.SLACK_BOT_TOKEN;
const PRIOR_SIG = process.env.SLACK_SIGNING_SECRET;

let approvalStoreRef: InMemoryApprovalStore;
let auditStoreRef: InMemoryAuditStore;
let pauseSinkRef: InMemoryPauseSink;
let violationStoreRef: InMemoryViolationStore;
let correctionStoreRef: InMemoryCorrectionStore;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_SIGNING_SECRET;
  approvalStoreRef = new InMemoryApprovalStore();
  auditStoreRef = new InMemoryAuditStore();
  pauseSinkRef = new InMemoryPauseSink();
  violationStoreRef = new InMemoryViolationStore();
  correctionStoreRef = new InMemoryCorrectionStore();
  __resetStores();
  __setStoresForTest({
    approval: approvalStoreRef,
    audit: auditStoreRef,
    pause: pauseSinkRef,
    violation: violationStoreRef,
    correction: correctionStoreRef,
  });
});

afterEach(() => {
  if (PRIOR_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = PRIOR_CRON;
  if (PRIOR_BOT === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = PRIOR_BOT;
  if (PRIOR_SIG === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = PRIOR_SIG;
  __resetStores();
});

function req(): Request {
  return new Request("https://example.test/api/ops/control-plane/health", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function violation(agentId: string): PolicyViolation {
  return {
    id: "v",
    runId: "r",
    agentId,
    division: "sales",
    kind: "missing_citation",
    detail: "x",
    detectedBy: "drift-audit",
    detectedAt: new Date().toISOString(),
  };
}

describe("GET /api/ops/control-plane/health", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await GET(new Request("https://example.test/api/ops/control-plane/health"));
    expect(res.status).toBe(401);
  });

  it("fresh cloud install with empty stores + no Slack → unready + 503 (Slack is a required component)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.summary).toContain("UNREADY");
    expect(body.components.slackConfig.status).toBe("unready");
    expect(body.components.violationStore.status).toBe("degraded");
    expect(body.components.correctionStore.status).toBe("degraded");
    expect(body.components.approvalStore.status).toBe("ready");
    expect(body.components.auditStore.status).toBe("ready");
    expect(body.components.pauseSink.status).toBe("ready");
    expect(body.components.cronSecret.status).toBe("ready");
  });

  it("with Slack fully configured + stores seeded → ready + 200 + not degraded", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-stub";
    process.env.SLACK_SIGNING_SECRET = "stub-sig";
    await violationStoreRef.append(violation("viktor"));
    await correctionStoreRef.append({
      id: "c",
      at: new Date().toISOString(),
      agentId: "viktor",
      division: "sales",
      correctedBy: "Ben",
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.summary).toContain("all components healthy");
    expect(body.components.slackConfig.status).toBe("ready");
    expect(body.components.violationStore.status).toBe("ready");
    expect(body.components.correctionStore.status).toBe("ready");
  });

  it("Slack signing secret present but bot token absent → degraded (approvals still verify; posts no-op)", async () => {
    process.env.SLACK_SIGNING_SECRET = "stub-sig";
    await violationStoreRef.append(violation("viktor"));
    await correctionStoreRef.append({
      id: "c",
      at: new Date().toISOString(),
      agentId: "viktor",
      division: "sales",
      correctedBy: "Ben",
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.components.slackConfig.status).toBe("degraded");
    expect(body.components.slackApprovalRoute.status).toBe("ready");
    expect(body.components.dailyBriefRoute.status).toBe("degraded");
  });

  it("Slack bot token present but signing secret missing → approval route unready → 503", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-stub";
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.components.slackApprovalRoute.status).toBe("unready");
    expect(body.components.slackConfig.status).toBe("unready");
  });

  it("surfaces store unreachability as unready with the underlying detail", async () => {
    __setStoresForTest({
      approval: {
        async put() {
          throw new Error("KV down");
        },
        async get() {
          return null;
        },
        async listPending() {
          throw new Error("KV down");
        },
        async listByAgent() {
          return [];
        },
      },
    });
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.components.approvalStore.status).toBe("unready");
    expect(body.components.approvalStore.detail).toContain("KV down");
  });

  it("pauseSink component lists currently paused agent ids for operators", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-stub";
    process.env.SLACK_SIGNING_SECRET = "stub-sig";
    await pauseSinkRef.pauseAgent({
      agentId: "viktor",
      division: "sales",
      reason: "2 violations",
      violationsInWindow: 2,
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      scorecardId: "sc-1",
      pausedAt: new Date().toISOString(),
    });
    // Populate violation/correction stores so slack isn't the only concern.
    await violationStoreRef.append(violation("viktor"));
    await correctionStoreRef.append({
      id: "c",
      at: new Date().toISOString(),
      agentId: "viktor",
      division: "sales",
      correctedBy: "Ben",
    });
    const res = await GET(req());
    const body = await res.json();
    expect(body.components.pauseSink.pausedCount).toBe(1);
    expect(body.components.pauseSink.pausedAgents).toEqual(["viktor"]);
  });

  it("auditStore.hasEntries reflects state (empty vs populated)", async () => {
    // Empty first.
    const r1 = await GET(req());
    const b1 = await r1.json();
    expect(b1.components.auditStore.hasEntries).toBe(false);

    // Seed one.
    const run = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    await auditStoreRef.append(
      buildAuditEntry(run, { action: "x", entityType: "t", result: "ok" }),
    );
    const r2 = await GET(req());
    const b2 = await r2.json();
    expect(b2.components.auditStore.hasEntries).toBe(true);
  });
});
