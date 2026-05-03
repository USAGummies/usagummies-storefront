/**
 * Pipeline evidence store coverage.
 *
 * Pins:
 *   - listPipelineEvidence empty + degraded passthrough
 *   - appendPipelineEvidence persists + returns new row
 *   - idempotency: same stage+source+sourceId+evidenceType doesn't double-record
 *   - clamps confidence to [0,1]
 *   - cap at MAX_PER_DEAL (200) — older rows roll off
 *   - listPipelineTransitions / appendPipelineTransition round-trip
 */
import { describe, expect, it } from "vitest";

import {
  appendPipelineEvidence,
  appendPipelineTransition,
  listPipelineEvidence,
  listPipelineTransitions,
  type KvLikePipelineStore,
} from "../pipeline-evidence-store";
import type {
  PipelineEvidence,
  PipelineTransition,
} from "../pipeline-evidence";

function makeStore(): KvLikePipelineStore & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async <T>(key: string) => (data[key] as T | undefined) ?? null,
    set: async (key, value) => {
      data[key] = value;
      return "OK";
    },
  };
}

describe("listPipelineEvidence", () => {
  it("returns empty array on cold key", async () => {
    const store = makeStore();
    const r = await listPipelineEvidence("deal-1", store);
    expect(r.evidence).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it("fail-soft on store throw", async () => {
    const broken: KvLikePipelineStore = {
      get: async () => {
        throw new Error("kv-down");
      },
      set: async () => "OK",
    };
    const r = await listPipelineEvidence("deal-1", broken);
    expect(r.evidence).toEqual([]);
    expect(r.degraded[0]).toMatch(/evidence/);
    expect(r.degraded[0]).toMatch(/kv-down/);
  });
});

describe("appendPipelineEvidence", () => {
  it("persists a new evidence row + returns the canonical record", async () => {
    const store = makeStore();
    const r = await appendPipelineEvidence(
      {
        dealId: "deal-1",
        stage: "po_received",
        evidenceType: "po_document",
        source: "gmail",
        sourceId: "gmail-msg-42",
        evidenceAt: "2026-05-02T18:00:00.000Z",
        actor: "agent:viktor",
        confidence: 0.95,
      },
      { store, now: new Date("2026-05-02T18:00:30.000Z"), id: "pev-1" },
    );
    expect(r.id).toBe("pev-1");
    expect(r.recordedAt).toBe("2026-05-02T18:00:30.000Z");
    const read = await listPipelineEvidence("deal-1", store);
    expect(read.evidence).toHaveLength(1);
    expect(read.evidence[0].id).toBe("pev-1");
  });

  it("idempotent on stage+source+sourceId+evidenceType", async () => {
    const store = makeStore();
    const first = await appendPipelineEvidence(
      {
        dealId: "deal-1",
        stage: "paid",
        evidenceType: "qbo_payment_record",
        source: "qbo",
        sourceId: "qbo-pay-99",
        evidenceAt: "2026-05-02T18:00:00.000Z",
        actor: "agent:viktor",
        confidence: 0.9,
      },
      { store, id: "pev-1" },
    );
    const second = await appendPipelineEvidence(
      {
        dealId: "deal-1",
        stage: "paid",
        evidenceType: "qbo_payment_record",
        source: "qbo",
        sourceId: "qbo-pay-99",
        evidenceAt: "2026-05-02T19:00:00.000Z",
        actor: "agent:viktor",
        confidence: 0.95,
      },
      { store, id: "pev-2" },
    );
    expect(second.id).toBe(first.id); // returned the existing row
    const read = await listPipelineEvidence("deal-1", store);
    expect(read.evidence).toHaveLength(1);
  });

  it("clamps confidence to [0, 1]", async () => {
    const store = makeStore();
    const high = await appendPipelineEvidence(
      {
        dealId: "deal-1",
        stage: "interested",
        evidenceType: "buyer_reply_email",
        source: "gmail",
        sourceId: "msg-1",
        evidenceAt: "2026-05-02T18:00:00.000Z",
        actor: "agent",
        confidence: 9,
      },
      { store, id: "high" },
    );
    expect(high.confidence).toBe(1);
    const low = await appendPipelineEvidence(
      {
        dealId: "deal-1",
        stage: "interested",
        evidenceType: "buyer_reply_email",
        source: "gmail",
        sourceId: "msg-2",
        evidenceAt: "2026-05-02T18:00:00.000Z",
        actor: "agent",
        confidence: -1,
      },
      { store, id: "low" },
    );
    expect(low.confidence).toBe(0);
  });
});

describe("transitions", () => {
  it("appendPipelineTransition + listPipelineTransitions round-trip", async () => {
    const store = makeStore();
    const t: PipelineTransition = {
      at: "2026-05-02T18:00:00.000Z",
      fromStage: "quote_sent",
      toStage: "po_received",
      verification: "system_verified",
      evidenceIds: ["pev-1"],
      reason: "PO doc received via gmail",
      actor: "agent:viktor",
    };
    await appendPipelineTransition("deal-1", t, store);
    const r = await listPipelineTransitions("deal-1", store);
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0].toStage).toBe("po_received");
  });
});

describe("cap behavior", () => {
  it("caps at MAX_PER_DEAL (200) — oldest rows roll off", async () => {
    const store = makeStore();
    for (let i = 0; i < 250; i++) {
      // Use unique sourceIds so idempotency doesn't dedupe.
      await appendPipelineEvidence(
        {
          dealId: "deal-cap",
          stage: "interested",
          evidenceType: "buyer_reply_email",
          source: "gmail",
          sourceId: `msg-${i}`,
          evidenceAt: "2026-05-02T18:00:00.000Z",
          actor: "agent",
          confidence: 0.5,
        },
        { store, id: `pev-${i}` },
      );
    }
    const r = await listPipelineEvidence("deal-cap", store);
    expect(r.evidence).toHaveLength(200);
    // Should be the LATEST 200 (msg-50 through msg-249)
    expect(r.evidence[0].sourceId).toBe("msg-50");
    expect(r.evidence[199].sourceId).toBe("msg-249");
  });
});

// Suppress unused imports
void {} as unknown as PipelineEvidence;
