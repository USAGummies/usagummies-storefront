/**
 * Unit test for KvApprovalStore dedup (no duplicate per-agent listing
 * after multiple put() calls for the same approval id).
 *
 * Uses a tiny FakeRedis that implements only the subset of the
 * @upstash/redis API the control plane touches. Injected via
 * __setKvClientForTest().
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApprovalRequest, applyDecision } from "../approvals";
import { KvApprovalStore } from "../stores/kv-stores";
import {
  __setKvClientForTest,
  __resetKvClient,
} from "../stores/kv-stores";

// -------- Minimal in-process Redis double --------

type SetArgs = {
  score: number;
  member: string;
};

interface Pipeline {
  set(k: string, v: string): Pipeline;
  lpush(k: string, ...vals: string[]): Pipeline;
  lrem(k: string, count: number, v: string): Pipeline;
  ltrim(k: string, start: number, stop: number): Pipeline;
  sadd(k: string, v: string): Pipeline;
  srem(k: string, v: string): Pipeline;
  zadd(k: string, entry: SetArgs): Pipeline;
  exec(): Promise<unknown[]>;
}

class FakeRedis {
  data = new Map<string, string>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();

  multi(): Pipeline {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    const pipeline: Pipeline = {
      set: (k: string, v: string) => {
        ops.push(() => self.set(k, v));
        return pipeline;
      },
      lpush: (k: string, ...vals: string[]) => {
        ops.push(() => self.lpush(k, ...vals));
        return pipeline;
      },
      lrem: (k: string, count: number, v: string) => {
        ops.push(() => self.lrem(k, count, v));
        return pipeline;
      },
      ltrim: (k: string, start: number, stop: number) => {
        ops.push(() => self.ltrim(k, start, stop));
        return pipeline;
      },
      sadd: (k: string, v: string) => {
        ops.push(() => self.sadd(k, v));
        return pipeline;
      },
      srem: (k: string, v: string) => {
        ops.push(() => self.srem(k, v));
        return pipeline;
      },
      zadd: (k: string, entry: SetArgs) => {
        ops.push(() => self.zadd(k, entry));
        return pipeline;
      },
      exec: async () => {
        const results: unknown[] = [];
        for (const op of ops) results.push(await op());
        return results;
      },
    };
    return pipeline;
  }

  async set(k: string, v: string) {
    this.data.set(k, v);
    return "OK";
  }
  async get<T = string>(k: string): Promise<T | null> {
    const v = this.data.get(k);
    return (v ?? null) as T | null;
  }
  async mget<T = string>(...keys: string[]): Promise<(T | null)[]> {
    return keys.map((k) => (this.data.get(k) ?? null) as T | null);
  }
  async lpush(k: string, ...vals: string[]) {
    const list = this.lists.get(k) ?? [];
    for (const v of vals) list.unshift(v);
    this.lists.set(k, list);
    return list.length;
  }
  async lrem(k: string, _count: number, v: string) {
    const list = this.lists.get(k) ?? [];
    const filtered = list.filter((x) => x !== v);
    this.lists.set(k, filtered);
    return list.length - filtered.length;
  }
  async ltrim(k: string, start: number, stop: number) {
    const list = this.lists.get(k) ?? [];
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    this.lists.set(k, list.slice(start, normalizedStop + 1));
    return "OK";
  }
  async lrange(k: string, start: number, stop: number) {
    const list = this.lists.get(k) ?? [];
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    return list.slice(start, normalizedStop + 1);
  }
  async sadd(k: string, v: string) {
    const set = this.sets.get(k) ?? new Set();
    set.add(v);
    this.sets.set(k, set);
    return 1;
  }
  async srem(k: string, v: string) {
    this.sets.get(k)?.delete(v);
    return 1;
  }
  async smembers(k: string) {
    return [...(this.sets.get(k) ?? [])];
  }
  async zadd(k: string, entry: SetArgs) {
    const zset = this.zsets.get(k) ?? new Map();
    zset.set(entry.member, entry.score);
    this.zsets.set(k, zset);
    return 1;
  }
  async zrange<T = string>(
    k: string,
    min: number,
    max: number | "+inf",
    opts?: { byScore?: boolean },
  ): Promise<T[]> {
    const zset = this.zsets.get(k) ?? new Map<string, number>();
    if (opts?.byScore) {
      const entries = [...zset.entries()].filter(([, score]) => {
        if (max === "+inf") return score >= min;
        return score >= min && score <= (max as number);
      });
      entries.sort((a, b) => a[1] - b[1]);
      return entries.map(([m]) => m) as T[];
    }
    return [...zset.keys()] as T[];
  }
}

// -------- Fixture helpers --------

function baseRequest() {
  return buildApprovalRequest({
    actionSlug: "gmail.send",
    runId: "run-dedup",
    division: "sales",
    actorAgentId: "viktor",
    targetSystem: "gmail",
    payloadPreview: "Reply to Jungle Jim's",
    evidence: {
      claim: "Warm lead asked for vendor packet",
      sources: [{ system: "gmail", id: "t-1", retrievedAt: new Date().toISOString() }],
      confidence: 0.92,
    },
    rollbackPlan: "Recall within 30min",
  });
}

// -------- Tests --------

describe("KvApprovalStore — per-agent listing dedup", () => {
  let fake: FakeRedis;
  let store: KvApprovalStore;

  beforeEach(() => {
    fake = new FakeRedis();
    __setKvClientForTest(fake);
    store = new KvApprovalStore();
  });

  afterEach(() => {
    __resetKvClient();
  });

  it("put() twice for the same approval id produces exactly one per-agent list entry", async () => {
    const req = baseRequest();
    await store.put(req);
    await store.put(req);
    await store.put(req);

    const list = fake.lists.get(`3.0:approvals:agent:${req.actorAgentId}`) ?? [];
    expect(list).toEqual([req.id]);

    const byAgent = await store.listByAgent(req.actorAgentId);
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0].id).toBe(req.id);
  });

  it("state transitions (pending → approved) still leave one list entry", async () => {
    const req = baseRequest();
    await store.put(req);
    const approved = applyDecision(req, { approver: "Ben", decision: "approve" });
    await store.put(approved);

    const list = fake.lists.get(`3.0:approvals:agent:${req.actorAgentId}`) ?? [];
    expect(list).toEqual([req.id]);

    const byAgent = await store.listByAgent(req.actorAgentId);
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0].status).toBe("approved");
  });

  it("two distinct approvals for the same agent both appear, newest-first", async () => {
    const r1 = baseRequest();
    const r2 = baseRequest();
    expect(r1.id).not.toBe(r2.id);
    await store.put(r1);
    await store.put(r2);

    const list = fake.lists.get(`3.0:approvals:agent:${r1.actorAgentId}`) ?? [];
    // Newest-first: r2 was put last so it should be at the head.
    expect(list).toEqual([r2.id, r1.id]);
  });

  it("pending-set membership follows status", async () => {
    const req = baseRequest();
    await store.put(req);
    expect([...(fake.sets.get("3.0:approvals:pending") ?? [])]).toContain(req.id);

    const approved = applyDecision(req, { approver: "Ben", decision: "approve" });
    await store.put(approved);
    expect([...(fake.sets.get("3.0:approvals:pending") ?? [])]).not.toContain(req.id);
  });
});
