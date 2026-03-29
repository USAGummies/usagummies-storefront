import { describe, expect, it, vi } from "vitest";
import { routeMessage } from "@/lib/ops/operator/deterministic-router";

vi.mock("server-only", () => ({}));

describe("deterministic router meeting intent", () => {
  it("routes meeting verification questions away from finance/email fallback", () => {
    const routed = routeMessage(
      "what day is my powers meeting? Can you verify from my email please?",
      "Ben",
      {
        history: [
          { role: "assistant", content: "Today is Powers meeting day." },
        ],
      },
    );

    expect(routed?.action).toBe("query_meeting_context");
    expect(routed?.intent).toBe("meeting_lookup");
  });

  it("routes meeting-date corrections to acknowledgment instead of transaction work", () => {
    const routed = routeMessage(
      "you know my meeting with powers was the 25th from the information in my emails. So how is today the powers meeting day?",
      "Ben",
      {
        history: [
          { role: "assistant", content: "Today is Powers meeting day." },
        ],
      },
    );

    expect(routed?.action).toBe("acknowledge_meeting_correction");
    expect(routed?.intent).toBe("meeting_correction");
  });
});

describe("bank feed sweep dedup", () => {
  it("skips reposting identical sweep results on the same day", async () => {
    const { buildBankFeedSweepSignature, shouldPostBankFeedSweepUpdate } = await import("@/lib/ops/sweeps/bank-feed-sweep");
    const result = {
      total: 41,
      highConfidence: 0,
      lowConfidence: 41,
      applied: 0,
      investorTransfers: 0,
    };
    const signature = buildBankFeedSweepSignature(result, 0);
    const previous = { date: "2026-03-28", signature };

    expect(shouldPostBankFeedSweepUpdate(previous, "2026-03-28", signature)).toBe(false);
  });

  it("allows reposting when the actionable review burden changes or the day changes", async () => {
    const { buildBankFeedSweepSignature, shouldPostBankFeedSweepUpdate } = await import("@/lib/ops/sweeps/bank-feed-sweep");
    const result = {
      total: 41,
      highConfidence: 0,
      lowConfidence: 41,
      applied: 0,
      investorTransfers: 0,
    };
    const signature = buildBankFeedSweepSignature(result, 0);
    const changed = buildBankFeedSweepSignature({ ...result, lowConfidence: 40 }, 0);
    const previous = { date: "2026-03-28", signature };

    expect(shouldPostBankFeedSweepUpdate(previous, "2026-03-28", changed)).toBe(true);
    expect(shouldPostBankFeedSweepUpdate(previous, "2026-03-29", signature)).toBe(true);
  });

  it("ignores harmless total/applied changes when the manual-review burden is unchanged", async () => {
    const { buildBankFeedSweepSignature } = await import("@/lib/ops/sweeps/bank-feed-sweep");
    const first = buildBankFeedSweepSignature({
      total: 41,
      highConfidence: 3,
      lowConfidence: 41,
      applied: 3,
      investorTransfers: 0,
    }, 0);
    const second = buildBankFeedSweepSignature({
      total: 38,
      highConfidence: 6,
      lowConfidence: 41,
      applied: 6,
      investorTransfers: 0,
    }, 0);

    expect(second).toBe(first);
  });
});
