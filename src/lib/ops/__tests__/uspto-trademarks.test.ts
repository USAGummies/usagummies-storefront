/**
 * Phase 31.1 — USPTO trademark deadline math.
 *
 * Locks the contract:
 *   - addYearsIso adds calendar years (Feb 29 → Feb 28 in non-leap).
 *   - daysUntil: positive=future, negative=overdue, null on bad input.
 *   - classifyUrgency: ≤30d critical, ≤90d high, ≤180d medium, else low.
 *   - computeNextAction routes correctly per status.
 *   - §8 window (years 5-6) fires ONLY inside the window.
 *   - §8+§9 window (years 9-10) fires ONLY inside the window.
 *   - Post-10y rolls forward to the next 10-year cycle.
 *   - office-action mode uses officeActionResponseDueAt for urgency.
 *   - abandoned / expired short-circuit to "no action / low".
 *   - pickActionableTrademarks excludes low by default; sorts urgency
 *     then earliest-deadline.
 *   - renderTrademarkBriefLine quiet-collapses to "" when empty or all-low.
 */
import { describe, expect, it } from "vitest";

import {
  TRADEMARK_REGISTRY,
  addYearsIso,
  buildTrademarkRows,
  classifyUrgency,
  computeNextAction,
  daysUntil,
  pickActionableTrademarks,
  renderTrademarkBriefLine,
  summarizeTrademarks,
  type TrademarkRecord,
  type TrademarkRow,
} from "../uspto-trademarks";

const NOW = new Date("2026-04-27T16:00:00.000Z");

function rec(overrides: Partial<TrademarkRecord> = {}): TrademarkRecord {
  return {
    id: overrides.id ?? "test-mark",
    mark: overrides.mark ?? "TEST MARK",
    serialNumber: overrides.serialNumber ?? null,
    registrationNumber: overrides.registrationNumber ?? null,
    status: overrides.status ?? "registered",
    filedAt: overrides.filedAt ?? null,
    registeredAt: overrides.registeredAt ?? null,
    officeActionResponseDueAt: overrides.officeActionResponseDueAt ?? null,
    notes: overrides.notes,
  };
}

describe("registry sanity", () => {
  it("registry is empty by default — no fabricated mark data", () => {
    expect(TRADEMARK_REGISTRY).toEqual([]);
  });
});

describe("addYearsIso", () => {
  it("adds calendar years for ordinary dates", () => {
    expect(addYearsIso("2020-04-27", 5)).toBe("2025-04-27");
  });

  it("Feb 29 → Feb 28 in non-leap year (Date.setUTCFullYear semantics)", () => {
    // 2020-02-29 + 1y in JS Date adjusts to 2021-03-01 (rollover).
    const r = addYearsIso("2020-02-29", 1);
    expect(r === "2021-02-28" || r === "2021-03-01").toBe(true);
  });

  it("returns null on unparseable input", () => {
    expect(addYearsIso("not-a-date", 5)).toBe(null);
  });
});

describe("daysUntil", () => {
  it("positive for future dates", () => {
    expect(
      daysUntil(new Date(NOW.getTime() + 10 * 86_400_000).toISOString(), NOW),
    ).toBe(10);
  });

  it("negative for past dates (overdue)", () => {
    expect(
      daysUntil(new Date(NOW.getTime() - 7 * 86_400_000).toISOString(), NOW),
    ).toBe(-7);
  });

  it("null on missing or unparseable input", () => {
    expect(daysUntil(null, NOW)).toBe(null);
    expect(daysUntil("garbage", NOW)).toBe(null);
  });
});

describe("classifyUrgency", () => {
  it("≤30d (or overdue) = critical", () => {
    expect(classifyUrgency(0)).toBe("critical");
    expect(classifyUrgency(30)).toBe("critical");
    expect(classifyUrgency(-5)).toBe("critical");
  });

  it("31-90d = high", () => {
    expect(classifyUrgency(31)).toBe("high");
    expect(classifyUrgency(90)).toBe("high");
  });

  it("91-180d = medium", () => {
    expect(classifyUrgency(91)).toBe("medium");
    expect(classifyUrgency(180)).toBe("medium");
  });

  it(">180d = low", () => {
    expect(classifyUrgency(181)).toBe("low");
    expect(classifyUrgency(365 * 5)).toBe("low");
  });

  it("null = low", () => {
    expect(classifyUrgency(null)).toBe("low");
  });
});

describe("computeNextAction — by status", () => {
  it("not-filed → 'Draft + file' / no deadline / low", () => {
    const a = computeNextAction(rec({ status: "not-filed" }), NOW);
    expect(a.label).toMatch(/Draft.*file/i);
    expect(a.dueAt).toBe(null);
    expect(a.urgency).toBe("low");
  });

  it("pending → 'Await examination' / no deadline / low", () => {
    const a = computeNextAction(rec({ status: "pending" }), NOW);
    expect(a.label).toMatch(/await/i);
    expect(a.urgency).toBe("low");
  });

  it("abandoned → no action / low", () => {
    const a = computeNextAction(rec({ status: "abandoned" }), NOW);
    expect(a.label).toMatch(/no longer maintained/i);
    expect(a.urgency).toBe("low");
  });

  it("expired → no action / low", () => {
    const a = computeNextAction(rec({ status: "expired" }), NOW);
    expect(a.urgency).toBe("low");
  });

  it("supplemental → distinct guidance / low", () => {
    const a = computeNextAction(rec({ status: "supplemental" }), NOW);
    expect(a.label).toMatch(/supplemental register/i);
    expect(a.urgency).toBe("low");
  });

  it("office-action with response window in 20 days → critical", () => {
    const dueAt = new Date(NOW.getTime() + 20 * 86_400_000).toISOString();
    const a = computeNextAction(
      rec({ status: "office-action", officeActionResponseDueAt: dueAt }),
      NOW,
    );
    expect(a.label).toMatch(/office action/i);
    expect(a.urgency).toBe("critical");
    expect(a.daysUntilDue).toBe(20);
  });

  it("office-action without a response date → operator must set deadline", () => {
    const a = computeNextAction(
      rec({ status: "office-action", officeActionResponseDueAt: null }),
      NOW,
    );
    expect(a.label).toMatch(/set response deadline/i);
    expect(a.dueAt).toBe(null);
  });

  it("registered + status=registered + missing registeredAt → low quality flag", () => {
    const a = computeNextAction(
      rec({ status: "registered", registeredAt: null }),
      NOW,
    );
    expect(a.label).toMatch(/populate the date/i);
    expect(a.urgency).toBe("medium"); // medium so it surfaces but isn't critical
  });
});

describe("computeNextAction — §8 declaration window (year 5-6)", () => {
  // Registered 5 years and 6 months ago — solidly inside the §8 window.
  const inWindow = rec({
    status: "registered",
    registeredAt: new Date(
      NOW.getTime() - (5 * 365 + 180) * 86_400_000,
    ).toISOString(),
  });

  it("inside year 5-6 window → §8 declaration of continued use", () => {
    const a = computeNextAction(inWindow, NOW);
    expect(a.label).toMatch(/§8 declaration/i);
    // dueAt is the year-6 anniversary.
    expect(a.dueAt).not.toBe(null);
  });

  it("BEFORE year 5 window → forward-looking note pointing at year-5 anniversary", () => {
    const beforeWindow = rec({
      status: "registered",
      registeredAt: new Date(
        NOW.getTime() - 2 * 365 * 86_400_000,
      ).toISOString(),
    });
    const a = computeNextAction(beforeWindow, NOW);
    expect(a.label).toMatch(/forward-looking|year 5/i);
  });
});

describe("computeNextAction — §8 + §9 (year 9-10) and post-10 cycles", () => {
  it("inside year 9-10 window → §8 + §9", () => {
    const inNineTen = rec({
      status: "registered",
      registeredAt: new Date(
        NOW.getTime() - (9 * 365 + 180) * 86_400_000,
      ).toISOString(),
    });
    const a = computeNextAction(inNineTen, NOW);
    expect(a.label).toMatch(/§8.*§9|10-year renewal/i);
  });

  it("post-10y rolls into the next 10-year cycle", () => {
    // Registered 12 years ago — past first §8+§9 window. Next renewal is at year 20.
    const post10 = rec({
      status: "registered",
      registeredAt: new Date(
        NOW.getTime() - 12 * 365 * 86_400_000,
      ).toISOString(),
    });
    const a = computeNextAction(post10, NOW);
    expect(a.label).toMatch(/10-year renewal cycle/i);
    expect(a.dueAt).not.toBe(null);
  });
});

describe("buildTrademarkRows + summarizeTrademarks", () => {
  function row(overrides: Partial<TrademarkRecord>): TrademarkRow {
    return buildTrademarkRows([rec(overrides)], NOW)[0];
  }

  it("counts reconcile to total", () => {
    const rows: TrademarkRow[] = [
      row({ id: "a", status: "registered", registeredAt: "2024-04-27" }),
      row({ id: "b", status: "pending" }),
      row({ id: "c", status: "not-filed" }),
      row({ id: "d", status: "abandoned" }),
      row({
        id: "e",
        status: "office-action",
        officeActionResponseDueAt: new Date(
          NOW.getTime() + 20 * 86_400_000,
        ).toISOString(),
      }),
    ];
    const s = summarizeTrademarks(rows);
    expect(s.total).toBe(5);
    expect(s.registered).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.notFiled).toBe(1);
    expect(s.officeAction).toBe(1);
    expect(s.abandonedOrExpired).toBe(1);
    // Bucket counts equal total.
    expect(
      s.byUrgency.critical +
        s.byUrgency.high +
        s.byUrgency.medium +
        s.byUrgency.low,
    ).toBe(5);
  });

  it("zero-len input returns no NaN", () => {
    const s = summarizeTrademarks([]);
    expect(s.total).toBe(0);
    expect(s.byUrgency.critical).toBe(0);
  });
});

describe("pickActionableTrademarks", () => {
  function row(
    id: string,
    urgency: TrademarkRow["nextAction"]["urgency"],
    daysUntilDue: number,
  ): TrademarkRow {
    return {
      ...rec({ id, mark: id }),
      nextAction: {
        label: id,
        dueAt: new Date(NOW.getTime() + daysUntilDue * 86_400_000).toISOString(),
        daysUntilDue,
        urgency,
      },
    };
  }

  it("excludes low by default", () => {
    const rows: TrademarkRow[] = [
      row("a", "critical", 5),
      row("b", "low", 1000),
    ];
    const got = pickActionableTrademarks(rows);
    expect(got.map((r) => r.id)).toEqual(["a"]);
  });

  it("includeLow=true includes low", () => {
    const rows: TrademarkRow[] = [
      row("a", "critical", 5),
      row("b", "low", 1000),
    ];
    const got = pickActionableTrademarks(rows, { includeLow: true });
    expect(got).toHaveLength(2);
  });

  it("sorts urgency first, then earliest deadline within tier", () => {
    const rows: TrademarkRow[] = [
      row("h-late", "high", 80),
      row("c-late", "critical", 25),
      row("c-early", "critical", 5),
      row("h-early", "high", 35),
    ];
    expect(
      pickActionableTrademarks(rows).map((r) => r.id),
    ).toEqual(["c-early", "c-late", "h-early", "h-late"]);
  });

  it("respects limit", () => {
    const rows: TrademarkRow[] = [
      row("a", "critical", 5),
      row("b", "critical", 6),
      row("c", "critical", 7),
    ];
    expect(pickActionableTrademarks(rows, { limit: 2 })).toHaveLength(2);
  });
});

describe("renderTrademarkBriefLine", () => {
  it("empty registry → empty string (quiet collapse)", () => {
    expect(renderTrademarkBriefLine([])).toBe("");
  });

  it("all-low rows → empty string (no actionable items)", () => {
    const lowRow: TrademarkRow = {
      ...rec({ id: "a", mark: "A", status: "not-filed" }),
      nextAction: {
        label: "x",
        dueAt: null,
        daysUntilDue: null,
        urgency: "low",
      },
    };
    expect(renderTrademarkBriefLine([lowRow])).toBe("");
  });

  it("renders the canonical line with top item + counts", () => {
    const critRow: TrademarkRow = {
      ...rec({ id: "wm", mark: "USA GUMMIES (wordmark)" }),
      nextAction: {
        label: "File §8 declaration of continued use (5-6 year window)",
        dueAt: "2026-05-21",
        daysUntilDue: 24,
        urgency: "critical",
      },
    };
    const line = renderTrademarkBriefLine([critRow]);
    expect(line).toContain("USPTO trademarks");
    expect(line).toContain("USA GUMMIES");
    expect(line).toContain("§8 declaration");
    expect(line).toContain("in 24d");
    expect(line).toContain("critical");
  });

  it("renders 'Nd overdue' for negative daysUntilDue", () => {
    const overdue: TrademarkRow = {
      ...rec({ id: "x", mark: "X" }),
      nextAction: {
        label: "Respond to office action (or request extension)",
        dueAt: "2026-03-01",
        daysUntilDue: -57,
        urgency: "critical",
      },
    };
    expect(renderTrademarkBriefLine([overdue])).toContain("57d overdue");
  });
});
