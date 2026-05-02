/**
 * Email-agent queue coverage — Build 3.
 *
 * Pins:
 *   - summarizeEmailAgentQueue counts by status + category + whale.
 *   - oldestReceived picks the earliest observedAt with status=received.
 *   - topRows excludes received_noise + sorts most-recently-observed first.
 *   - scanEmailAgentQueue projects ScannedRecord → lean row + applies
 *     statusFilter post-fetch.
 *   - KV scan errors → degraded list, never thrown.
 *   - Truncation flag fires when limit hit.
 */
import { describe, expect, it } from "vitest";

import {
  scanEmailAgentQueue,
  summarizeEmailAgentQueue,
  type EmailAgentQueueRow,
} from "../email-agent-queue";
import type { ScannedRecord } from "@/lib/sales/viktor/inbox-scanner";
import type { ClassifiedRecord } from "@/lib/sales/viktor/classifier";

function row(overrides: Partial<EmailAgentQueueRow> = {}): EmailAgentQueueRow {
  return {
    messageId: "m-1",
    threadId: "t-1",
    fromEmail: "buyer@example.com",
    fromHeader: "Buyer <buyer@example.com>",
    subject: "Sample request",
    date: "Thu, 01 May 2026 12:00:00 -0700",
    status: "classified",
    category: "A_sample_request",
    confidence: 0.9,
    classificationReason: "rule fired",
    observedAt: "2026-05-01T19:00:00.000Z",
    classifiedAt: "2026-05-01T19:00:30.000Z",
    ...overrides,
  };
}

describe("summarizeEmailAgentQueue", () => {
  it("counts by status + category + whale", () => {
    const s = summarizeEmailAgentQueue([
      row({ messageId: "a", status: "classified", category: "A_sample_request" }),
      row({ messageId: "b", status: "classified", category: "B_qualifying_question" }),
      row({ messageId: "c", status: "classified_whale", category: "S_whale_class" }),
      row({
        messageId: "d",
        status: "received",
        category: undefined,
        classificationReason: undefined,
        classifiedAt: undefined,
      }),
      row({
        messageId: "e",
        status: "received_noise",
        category: undefined,
        noiseReason: "linkedin.com",
        classificationReason: undefined,
        classifiedAt: undefined,
      }),
    ]);
    expect(s.total).toBe(5);
    expect(s.byStatus.classified).toBe(2);
    expect(s.byStatus.classified_whale).toBe(1);
    expect(s.byStatus.received).toBe(1);
    expect(s.byStatus.received_noise).toBe(1);
    expect(s.byCategory.A_sample_request).toBe(1);
    expect(s.byCategory.B_qualifying_question).toBe(1);
    expect(s.byCategory.S_whale_class).toBe(1);
    expect(s.whaleCount).toBe(1);
    expect(s.backlogReceived).toBe(1);
  });

  it("oldestReceived picks earliest observedAt status=received only", () => {
    const s = summarizeEmailAgentQueue([
      row({
        messageId: "a",
        status: "received",
        observedAt: "2026-05-01T08:00:00.000Z",
        category: undefined,
      }),
      row({
        messageId: "b",
        status: "received",
        observedAt: "2026-05-01T05:00:00.000Z",
        category: undefined,
      }),
      // classified — must NOT win even though observedAt is earlier
      row({
        messageId: "c",
        status: "classified",
        observedAt: "2026-05-01T01:00:00.000Z",
      }),
    ]);
    expect(s.oldestReceived?.messageId).toBe("b");
  });

  it("oldestReceived is null when nothing is received", () => {
    const s = summarizeEmailAgentQueue([
      row({ status: "classified" }),
      row({ messageId: "x", status: "received_noise" }),
    ]);
    expect(s.oldestReceived).toBeNull();
  });

  it("topRows excludes received_noise + sorts most-recently-observed first", () => {
    const s = summarizeEmailAgentQueue([
      row({ messageId: "old", observedAt: "2026-05-01T08:00:00.000Z" }),
      row({
        messageId: "noise",
        status: "received_noise",
        observedAt: "2026-05-01T20:00:00.000Z",
      }),
      row({ messageId: "new", observedAt: "2026-05-01T18:00:00.000Z" }),
    ]);
    expect(s.topRows.map((r) => r.messageId)).toEqual(["new", "old"]);
  });

  it("respects topN cap", () => {
    const rows: EmailAgentQueueRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(
        row({
          messageId: `r-${i}`,
          observedAt: new Date(Date.UTC(2026, 4, 1, i)).toISOString(),
        }),
      );
    }
    const s = summarizeEmailAgentQueue(rows, { topN: 3 });
    expect(s.topRows).toHaveLength(3);
  });
});

describe("scanEmailAgentQueue (KV scanner)", () => {
  function makeStore(records: Record<string, ScannedRecord | ClassifiedRecord>) {
    const keys = Object.keys(records);
    return {
      get: async <T>(key: string): Promise<T | null> =>
        (records[key] as T | undefined) ?? null,
      scan: async (
        cursor: string | number,
        sopts: { match: string; count?: number },
      ): Promise<[string | number, string[]]> => {
        // Simple single-page mock — scan returns all matching keys + cursor=0.
        const match = sopts.match.replace("*", "");
        const matched = keys.filter((k) => k.startsWith(match));
        return [0, matched];
      },
    };
  }

  function rec(overrides: Partial<ScannedRecord> = {}): ScannedRecord {
    return {
      messageId: "m-1",
      threadId: "t-1",
      fromEmail: "x@y.com",
      fromHeader: "X <x@y.com>",
      subject: "s",
      date: "Thu, 01 May 2026 12:00:00 -0700",
      snippet: "...",
      labelIds: [],
      status: "received",
      noiseReason: "",
      observedAt: "2026-05-01T18:00:00.000Z",
      ...overrides,
    };
  }

  it("projects ScannedRecord → lean row", async () => {
    const store = makeStore({
      "inbox:scan:m-1": rec({ messageId: "m-1" }),
    });
    const r = await scanEmailAgentQueue({ store });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].messageId).toBe("m-1");
    expect(r.rows[0].status).toBe("received");
    expect(r.degraded).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("projects ClassifiedRecord with category fields", async () => {
    const classified: ClassifiedRecord = {
      ...rec({ messageId: "c-1", status: "classified" as never }),
      category: "A_sample_request",
      confidence: 0.95,
      ruleId: "rule-foo",
      classificationReason: "matched sample regex",
      classifiedAt: "2026-05-01T19:00:00.000Z",
    };
    const store = makeStore({ "inbox:scan:c-1": classified });
    const r = await scanEmailAgentQueue({ store });
    expect(r.rows[0].category).toBe("A_sample_request");
    expect(r.rows[0].confidence).toBe(0.95);
    expect(r.rows[0].classifiedAt).toBe("2026-05-01T19:00:00.000Z");
    expect(r.rows[0].status).toBe("classified");
  });

  it("statusFilter narrows post-fetch", async () => {
    const store = makeStore({
      "inbox:scan:a": rec({ messageId: "a", status: "received" }),
      "inbox:scan:b": rec({ messageId: "b", status: "received_noise" }),
    });
    const r = await scanEmailAgentQueue({ store, statusFilter: "received_noise" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].messageId).toBe("b");
  });

  it("KV get error is collected in degraded, doesn't throw", async () => {
    const store = {
      get: async () => {
        throw new Error("boom");
      },
      scan: async () => [0, ["inbox:scan:bad"]] as [number, string[]],
    };
    const r = await scanEmailAgentQueue({ store });
    expect(r.rows).toEqual([]);
    expect(r.degraded[0]).toContain("kv-get");
    expect(r.degraded[0]).toContain("boom");
  });

  it("KV scan error is collected in degraded, doesn't throw", async () => {
    const store = {
      get: async () => null,
      scan: async () => {
        throw new Error("scan-down");
      },
    };
    const r = await scanEmailAgentQueue({ store });
    expect(r.rows).toEqual([]);
    expect(r.degraded[0]).toContain("kv-scan");
    expect(r.degraded[0]).toContain("scan-down");
  });

  it("limit fires truncated flag", async () => {
    const records: Record<string, ScannedRecord> = {};
    for (let i = 0; i < 30; i++) {
      records[`inbox:scan:r-${i}`] = rec({ messageId: `r-${i}` });
    }
    const store = makeStore(records);
    const r = await scanEmailAgentQueue({ store, limit: 5 });
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });

  it("missing record (null get) skipped silently", async () => {
    const store = {
      get: async () => null, // every get returns null
      scan: async () =>
        [0, ["inbox:scan:nope"]] as [number, string[]],
    };
    const r = await scanEmailAgentQueue({ store });
    expect(r.rows).toEqual([]);
    expect(r.degraded).toEqual([]);
  });
});
