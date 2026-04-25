/**
 * Receipt queue tests.
 *
 * Contract:
 *   - Fully structured receipts are marked `ready`.
 *   - Partial receipts are accepted as `needs_review` instead of rejected.
 *   - Missing amounts never inflate finance totals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        store.set(k, v);
        return "OK";
      }),
      __store: store,
    },
  };
});

import { kv } from "@vercel/kv";
import {
  getReceiptSummary,
  listReceipts,
  processReceipt,
} from "../docs";

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});

describe("receipt processing queue", () => {
  it("marks complete structured receipts ready", async () => {
    const receipt = await processReceipt({
      source_url: "https://drive.google.com/file/d/r1/view",
      source_channel: "receipts-capture",
      vendor: "ShipStation",
      date: "2026-04-25",
      amount: 47.22,
      category: "shipping",
    });

    expect(receipt.status).toBe("ready");
    expect(receipt.missing_fields).toBeUndefined();
    expect(receipt.amount).toBe(47.22);
  });

  it("accepts incomplete receipt documents as needs_review instead of dropping them", async () => {
    const receipt = await processReceipt({
      source_url: "gmail:msg-123",
      source_channel: "gmail",
      vendor: "Amazon",
      notes: "Invoice email flagged by email-intel.",
    });

    expect(receipt.status).toBe("needs_review");
    expect(receipt.missing_fields).toEqual(["date", "amount", "category"]);

    const listed = await listReceipts({ limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.source_url).toBe("gmail:msg-123");
  });

  it("summarizes ready and review receipts without counting missing amounts", async () => {
    await processReceipt({
      source_url: "gmail:needs-review",
      source_channel: "gmail",
      vendor: "Belmark",
    });
    await processReceipt({
      source_url: "https://drive.google.com/file/d/ready/view",
      source_channel: "receipts-capture",
      vendor: "Pirate Ship",
      date: "2026-04-25",
      amount: 12.34,
      category: "postage",
    });

    const summary = await getReceiptSummary();
    expect(summary.total_receipts).toBe(2);
    expect(summary.needs_review).toBe(1);
    expect(summary.ready).toBe(1);
    expect(summary.total_amount).toBe(12.34);
    expect(summary.by_vendor.Belmark.total).toBe(0);
    expect(summary.by_category.unreviewed.count).toBe(1);
  });
});
