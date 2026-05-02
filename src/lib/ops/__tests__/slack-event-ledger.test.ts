import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => {
  const map = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (key: string) => map.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        map.set(key, value);
        return "OK";
      }),
      __store: map,
    },
  };
});

import { kv } from "@vercel/kv";
import {
  appendSlackEventReceipt,
  listSlackEventReceipts,
} from "../slack-event-ledger";

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});

describe("slack-event-ledger", () => {
  it("stores safe metadata and truncates message snippets", async () => {
    const longText = `ask codex ${"x".repeat(400)} xoxb-do-not-store-full-body`;
    const record = await appendSlackEventReceipt(
      {
        eventId: "Ev1",
        teamId: "T1",
        eventType: "message",
        channel: "C_OPS",
        messageTs: "177.1",
        subtype: "bot_message",
        botIdPresent: true,
        recognizedCommand: "workpack",
        text: longText,
      },
      { now: new Date("2026-05-02T12:00:00.000Z") },
    );

    expect(record.id).toBe("slackevt_Ev1");
    expect(record.recognized).toBe(true);
    expect(record.textSnippet?.length).toBeLessThanOrEqual(180);
    expect(JSON.stringify(record)).not.toContain("x".repeat(300));
  });

  it("lists newest receipts first and dedupes by event id", async () => {
    await appendSlackEventReceipt(
      {
        eventId: "Ev1",
        eventType: "message",
        channel: "C1",
        skippedReason: "no-recognized-command",
      },
      { now: new Date("2026-05-02T12:00:00.000Z") },
    );
    await appendSlackEventReceipt(
      {
        eventId: "Ev2",
        eventType: "message",
        channel: "C2",
        recognizedCommand: "command-center",
      },
      { now: new Date("2026-05-02T12:01:00.000Z") },
    );
    await appendSlackEventReceipt(
      {
        eventId: "Ev1",
        eventType: "message",
        channel: "C1",
        recognizedCommand: "workpack",
      },
      { now: new Date("2026-05-02T12:02:00.000Z") },
    );

    const rows = await listSlackEventReceipts();
    expect(rows.map((r) => r.id)).toEqual(["slackevt_Ev1", "slackevt_Ev2"]);
    expect(rows[0].recognizedCommand).toBe("workpack");
  });

  it("clamps list limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await appendSlackEventReceipt({ eventId: `Ev${i}`, eventType: "message" });
    }
    await expect(listSlackEventReceipts({ limit: 2 })).resolves.toHaveLength(2);
  });
});
