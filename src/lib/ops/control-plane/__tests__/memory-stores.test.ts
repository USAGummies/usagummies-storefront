import { describe, it, expect, beforeEach } from "vitest";

import { buildApprovalRequest } from "../approvals";
import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import { InMemoryApprovalStore, InMemoryAuditStore } from "../stores/memory-stores";

function baseApproval() {
  return buildApprovalRequest({
    actionSlug: "gmail.send",
    runId: "run-1",
    division: "sales",
    actorAgentId: "viktor",
    targetSystem: "gmail",
    payloadPreview: "Reply to Jungle Jim's",
    evidence: {
      claim: "Warm lead asked for vendor packet",
      sources: [{ system: "gmail", id: "thread-1", retrievedAt: new Date().toISOString() }],
      confidence: 0.92,
    },
    rollbackPlan: "Recall within 30min",
  });
}

describe("InMemoryApprovalStore", () => {
  let store: InMemoryApprovalStore;
  beforeEach(() => {
    store = new InMemoryApprovalStore();
  });

  it("put + get round-trips deeply cloned", async () => {
    const req = baseApproval();
    await store.put(req);
    const fetched = await store.get(req.id);
    expect(fetched).toEqual(req);
    // Mutate the fetched copy; store must not change.
    fetched!.status = "approved";
    const refetched = await store.get(req.id);
    expect(refetched?.status).toBe("pending");
  });

  it("get returns null for unknown id", async () => {
    expect(await store.get("does-not-exist")).toBeNull();
  });

  it("listPending only returns pending, sorted createdAt ascending", async () => {
    const r1 = baseApproval();
    const r2 = { ...baseApproval(), createdAt: new Date(Date.now() + 1000).toISOString() };
    const r3 = { ...baseApproval(), status: "approved" as const };
    await store.put(r1);
    await store.put(r2);
    await store.put(r3);
    const pending = await store.listPending();
    expect(pending.map((p) => p.id)).toEqual([r1.id, r2.id]);
  });

  it("listByAgent filters + sorts newest-first + honors limit", async () => {
    const r1 = baseApproval();
    const r2 = { ...baseApproval(), createdAt: new Date(Date.now() + 1000).toISOString() };
    const r3 = { ...baseApproval(), actorAgentId: "someone-else" };
    await store.put(r1);
    await store.put(r2);
    await store.put(r3);
    const viktor = await store.listByAgent("viktor");
    expect(viktor.map((p) => p.id)).toEqual([r2.id, r1.id]);
    const viktorLimit1 = await store.listByAgent("viktor", 1);
    expect(viktorLimit1).toHaveLength(1);
    expect(viktorLimit1[0].id).toBe(r2.id);
  });
});

describe("InMemoryAuditStore", () => {
  let store: InMemoryAuditStore;
  beforeEach(() => {
    store = new InMemoryAuditStore();
  });

  const run = newRunContext({
    agentId: "viktor",
    division: "sales",
    source: "on-demand",
  });

  it("append + recent returns newest-first capped by limit", async () => {
    const e1 = buildAuditEntry(run, {
      action: "hubspot.task.create",
      entityType: "task",
      result: "ok",
    });
    const e2 = buildAuditEntry(run, {
      action: "open-brain.capture",
      entityType: "thought",
      result: "ok",
    }, new Date(Date.now() + 1000));
    await store.append(e1);
    await store.append(e2);
    const recent = await store.recent(10);
    expect(recent.map((e) => e.id)).toEqual([e2.id, e1.id]);
    expect(await store.recent(1)).toHaveLength(1);
  });

  it("byRun groups entries for a single run in chronological order", async () => {
    const runA = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    const runB = newRunContext({ agentId: "booke", division: "financials", source: "event" });
    const a1 = buildAuditEntry(runA, { action: "x.y", entityType: "t", result: "ok" });
    const a2 = buildAuditEntry(runA, {
      action: "x.z",
      entityType: "t",
      result: "ok",
    }, new Date(Date.now() + 500));
    const b1 = buildAuditEntry(runB, { action: "y.y", entityType: "t", result: "ok" });
    await store.append(a1);
    await store.append(b1);
    await store.append(a2);
    const onlyA = await store.byRun(runA.runId);
    expect(onlyA.map((e) => e.id)).toEqual([a1.id, a2.id]);
  });

  it("byAgent filters by agent + sinceISO cutoff", async () => {
    const runOld = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    const runNew = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    const old = buildAuditEntry(runOld, {
      action: "x.y",
      entityType: "t",
      result: "ok",
    }, new Date("2020-01-01T00:00:00Z"));
    const fresh = buildAuditEntry(runNew, {
      action: "x.y",
      entityType: "t",
      result: "ok",
    });
    await store.append(old);
    await store.append(fresh);
    const since = new Date("2025-01-01T00:00:00Z").toISOString();
    const result = await store.byAgent("viktor", since);
    expect(result.map((e) => e.id)).toEqual([fresh.id]);
  });

  it("cloning prevents external mutation of persisted state", async () => {
    const entry = buildAuditEntry(run, {
      action: "hubspot.deal.stage.move",
      entityType: "deal",
      entityId: "123",
      result: "ok",
    });
    await store.append(entry);
    const [got] = await store.recent(1);
    got.result = "error";
    const [refetched] = await store.recent(1);
    expect(refetched.result).toBe("ok");
  });
});
