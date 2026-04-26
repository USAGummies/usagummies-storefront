/**
 * Pure tests for revenue-kpi.ts.
 *
 * Locks the date math to Dec 24, 2026 (end of day Pacific), the
 * required-pace calculations, the no-fabrication contract, the
 * confidence rubric, and the brief renderer's "not fully wired"
 * fallback. Helpers are pure → no IO mocking.
 */
import { describe, expect, it } from "vitest";

import {
  KPI_TARGET_DEADLINE_ISO,
  KPI_TARGET_USD,
  composeRevenueKpi,
  daysRemaining,
  formatUsdCompact,
  renderRevenueKpiBriefLine,
  requiredDailyPaceUsd,
  requiredWeeklyPaceUsd,
  type ChannelRevenueState,
} from "../revenue-kpi";

const NOW = new Date("2026-04-25T16:00:00Z"); // mid-Apr 2026

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("KPI constants", () => {
  it("locked $1M target", () => {
    expect(KPI_TARGET_USD).toBe(1_000_000);
  });

  it("locked Dec 24, 2026 end-of-day Pacific deadline", () => {
    expect(KPI_TARGET_DEADLINE_ISO).toBe("2026-12-24T23:59:59-08:00");
    // Sanity-check that the literal parses to the right day in PT.
    const d = new Date(KPI_TARGET_DEADLINE_ISO);
    // 2026-12-24T23:59:59 PST = 2026-12-25T07:59:59Z
    expect(d.toISOString()).toBe("2026-12-25T07:59:59.000Z");
  });
});

// ---------------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------------

describe("daysRemaining", () => {
  it("counts whole days from now to the locked deadline (mid-Apr → end Dec)", () => {
    const d = daysRemaining(NOW);
    // Sanity bound: should be in the 240–250 range from 2026-04-25.
    expect(d).toBeGreaterThan(240);
    expect(d).toBeLessThan(250);
  });

  it("returns 0 when now is after the deadline (no negatives)", () => {
    const after = new Date("2027-01-01T00:00:00Z");
    expect(daysRemaining(after)).toBe(0);
  });

  it("returns 0 when now equals the deadline exactly", () => {
    const at = new Date(KPI_TARGET_DEADLINE_ISO);
    expect(daysRemaining(at)).toBe(0);
  });

  it("rounds up partial days so 0.5d → 1d remaining", () => {
    const tHalf = new Date(
      Date.parse(KPI_TARGET_DEADLINE_ISO) - 12 * 3600_000,
    );
    expect(daysRemaining(tHalf)).toBe(1);
  });

  it("supports a custom deadline override (test ergonomics)", () => {
    const customDeadline = new Date(NOW.getTime() + 100 * 24 * 3600_000).toISOString();
    expect(daysRemaining(NOW, customDeadline)).toBeGreaterThan(99);
    expect(daysRemaining(NOW, customDeadline)).toBeLessThanOrEqual(100);
  });

  it("returns 0 for an unparseable deadline (defensive)", () => {
    expect(daysRemaining(NOW, "not-a-date")).toBe(0);
  });
});

describe("requiredDailyPaceUsd / requiredWeeklyPaceUsd", () => {
  it("daily * 7 = weekly (locked relationship)", () => {
    expect(requiredWeeklyPaceUsd(NOW)).toBeCloseTo(
      requiredDailyPaceUsd(NOW) * 7,
      5,
    );
  });

  it("daily = target / daysRemaining (algebraic identity)", () => {
    const days = daysRemaining(NOW);
    expect(requiredDailyPaceUsd(NOW)).toBeCloseTo(KPI_TARGET_USD / days, 5);
  });

  it("returns 0 when deadline has passed (no division by zero, no negative pace)", () => {
    const after = new Date("2027-06-01T00:00:00Z");
    expect(requiredDailyPaceUsd(after)).toBe(0);
    expect(requiredWeeklyPaceUsd(after)).toBe(0);
  });

  it("supports a custom target", () => {
    expect(requiredDailyPaceUsd(NOW, 500_000)).toBeCloseTo(
      requiredDailyPaceUsd(NOW) / 2,
      5,
    );
  });
});

// ---------------------------------------------------------------------------
// composeRevenueKpi
// ---------------------------------------------------------------------------

function ch(
  channel: ChannelRevenueState["channel"],
  status: ChannelRevenueState["status"],
  amount: number | null,
  reason?: string,
): ChannelRevenueState {
  const base: ChannelRevenueState = { channel, status, amountUsd: amount };
  if (status === "wired" && amount !== null) {
    base.source = { system: `${channel}-test`, retrievedAt: NOW.toISOString() };
  }
  if (reason) base.reason = reason;
  return base;
}

describe("composeRevenueKpi — confidence rubric", () => {
  it("all 4 primary wired (Shopify+Amazon+Faire+B2B) → confidence='full'", () => {
    // Phase 5: B2B joined the primary set once Shopify wholesale-tagged
    // paid orders became a defensible read-only source. "unknown"
    // remains permanently outside the rubric (catch-all placeholder).
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 1500),
          ch("amazon", "wired", 800),
          ch("faire", "wired", 200),
          ch("b2b", "wired", 600),
          ch("unknown", "not_wired", null, "catch-all"),
        ],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("full");
  });

  it("3 primary wired but B2B not_wired → 'partial' (B2B is now primary)", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 1500),
          ch("amazon", "wired", 800),
          ch("faire", "wired", 200),
          ch("b2b", "not_wired", null, "SHOPIFY_ADMIN_API_TOKEN unset"),
        ],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("partial");
  });

  it("at least one primary wired + one not_wired → 'partial'", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 1500),
          ch("amazon", "error", null, "API down"),
          ch("faire", "not_wired", null, "FAIRE_ACCESS_TOKEN unset"),
        ],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("partial");
  });

  it("zero primary wired → 'none' (cannot compute)", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "not_wired", null, "no token"),
          ch("amazon", "error", null, "timed out"),
          ch("faire", "not_wired", null, "no token"),
        ],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("none");
  });

  it("only B2B wired → 'partial' (B2B is now primary; one of four)", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("b2b", "wired", 600),
          ch("unknown", "not_wired", null, "catch-all"),
        ],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("partial");
  });

  it("'unknown' channel alone never moves the rubric (permanent placeholder)", () => {
    const r = composeRevenueKpi(
      {
        channels: [ch("unknown", "not_wired", null, "catch-all")],
      },
      { now: NOW },
    );
    expect(r.confidence).toBe("none");
  });
});

describe("composeRevenueKpi — actual + gap math", () => {
  it("sums every wired channel; not_wired/error contribute zero", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 1500),
          ch("amazon", "wired", 800),
          ch("faire", "error", null, "API timeout"),
          ch("b2b", "not_wired", null, "no QBO join"),
        ],
      },
      { now: NOW },
    );
    expect(r.actualLast7dUsd).toBe(2300);
  });

  it("actualLast7dUsd is null when zero channels are wired (NOT a synthetic 0)", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "not_wired", null, "no token"),
          ch("amazon", "error", null, "timed out"),
          ch("faire", "not_wired", null, "no token"),
        ],
      },
      { now: NOW },
    );
    expect(r.actualLast7dUsd).toBeNull();
    expect(r.gapToWeeklyPaceUsd).toBeNull();
  });

  it("gap = actual - requiredWeekly (negative when behind)", () => {
    const r = composeRevenueKpi(
      {
        channels: [ch("shopify", "wired", 1000)],
      },
      { now: NOW, target: 365_000, deadlineIso: new Date(NOW.getTime() + 365 * 24 * 3600_000).toISOString() },
    );
    // Required daily = 1000, weekly = 7000. Actual = 1000. Gap = -6000.
    expect(r.requiredWeeklyUsd).toBeCloseTo(7000, 0);
    expect(r.gapToWeeklyPaceUsd).toBeCloseTo(-6000, 0);
  });

  it("defensive: a wired channel with NaN/Infinity is treated as missing (no contamination)", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          { channel: "shopify", status: "wired", amountUsd: NaN },
          ch("amazon", "wired", 500),
        ],
      },
      { now: NOW },
    );
    // The NaN row drops out; sum = 500.
    expect(r.actualLast7dUsd).toBe(500);
  });

  it("never mutates the caller's channels array", () => {
    const channels = [ch("shopify", "wired", 100)];
    const before = JSON.stringify(channels);
    const r = composeRevenueKpi({ channels }, { now: NOW });
    // Mutating the report's channels array must not propagate back.
    r.channels[0].amountUsd = 9999;
    expect(JSON.stringify(channels)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// formatUsdCompact
// ---------------------------------------------------------------------------

describe("formatUsdCompact", () => {
  it("formats <$1K, $1K-$10K, $10K-$1M, ≥$1M", () => {
    expect(formatUsdCompact(45)).toBe("$45");
    expect(formatUsdCompact(1234)).toBe("$1,234");
    expect(formatUsdCompact(12_400)).toBe("$12.4K");
    expect(formatUsdCompact(1_040_000)).toBe("$1.04M");
  });

  it("handles negatives (gap-behind path)", () => {
    expect(formatUsdCompact(-12_400)).toBe("-$12.4K");
  });

  it("returns '$—' for non-finite inputs (no NaN leak)", () => {
    expect(formatUsdCompact(NaN)).toBe("$—");
    expect(formatUsdCompact(Infinity)).toBe("$—");
  });
});

// ---------------------------------------------------------------------------
// renderRevenueKpiBriefLine — never fabricates
// ---------------------------------------------------------------------------

describe("renderRevenueKpiBriefLine", () => {
  it("falls back to 'not fully wired' when no channel is wired", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "not_wired", null, "no token"),
          ch("amazon", "error", null, "API down"),
          ch("faire", "not_wired", null, "no token"),
        ],
      },
      { now: NOW },
    );
    const slice = renderRevenueKpiBriefLine(r);
    expect(slice.text).toBe("Revenue pace not fully wired.");
    expect(slice.fullyWired).toBe(false);
  });

  it("renders compact line when fully wired", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 24_000),
          ch("amazon", "wired", 100),
          ch("faire", "wired", 0),
          ch("b2b", "wired", 0),
        ],
      },
      { now: NOW },
    );
    const slice = renderRevenueKpiBriefLine(r);
    expect(slice.fullyWired).toBe(true);
    expect(slice.text).toMatch(/Revenue pace:/);
    expect(slice.text).toMatch(/last 7d/);
    expect(slice.text).toMatch(/required\/wk/);
    expect(slice.text).toMatch(/(ahead|behind)/);
    // Confidence badge NOT appended on full.
    expect(slice.text).not.toContain("(partial");
    expect(slice.text).not.toContain("(none");
  });

  it("appends partial badge listing the dropped primary channels", () => {
    const r = composeRevenueKpi(
      {
        channels: [
          ch("shopify", "wired", 12_000),
          ch("amazon", "error", null, "timed out"),
          ch("faire", "not_wired", null, "no token"),
        ],
      },
      { now: NOW },
    );
    const slice = renderRevenueKpiBriefLine(r);
    expect(slice.fullyWired).toBe(false);
    expect(slice.text).toContain("partial:");
    expect(slice.text).toContain("amazon error");
    expect(slice.text).toContain("faire not_wired");
  });

  it("ahead shows '+' surplus; behind shows '-' deficit (never both signs)", () => {
    // Behind:
    const behind = composeRevenueKpi(
      { channels: [ch("shopify", "wired", 100), ch("amazon", "wired", 0), ch("faire", "wired", 0)] },
      { now: NOW },
    );
    expect(renderRevenueKpiBriefLine(behind).text).toMatch(/behind/);
    expect(renderRevenueKpiBriefLine(behind).text).not.toMatch(/\+\$/);
  });

  it("never includes a fabricated number when actualLast7dUsd is null", () => {
    const r = composeRevenueKpi({ channels: [] }, { now: NOW });
    expect(r.actualLast7dUsd).toBeNull();
    const slice = renderRevenueKpiBriefLine(r);
    expect(slice.text).toBe("Revenue pace not fully wired.");
    // Sanity: no $ sign in the fallback.
    expect(slice.text).not.toMatch(/\$/);
  });
});

// ---------------------------------------------------------------------------
// Read-only invariants
// ---------------------------------------------------------------------------

describe("read-only invariants", () => {
  it("composeRevenueKpi is deterministic for fixed input + now", () => {
    const input = {
      channels: [
        ch("shopify", "wired", 1000),
        ch("amazon", "error", null, "x"),
      ],
    };
    const a = composeRevenueKpi(input, { now: NOW });
    const b = composeRevenueKpi(input, { now: NOW });
    expect(a).toEqual(b);
  });
});
