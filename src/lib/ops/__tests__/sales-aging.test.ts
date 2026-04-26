/**
 * Pure tests for sales-aging.ts.
 *
 * Locks the threshold contract, the missing-timestamp behavior, the
 * sort order (critical → overdue → watch → fresh; oldest-first
 * within tier), and the brief-callout cap. The helpers are pure so
 * no IO mocking is needed.
 */
import { describe, expect, it } from "vitest";

import {
  AGING_THRESHOLDS,
  ageDays,
  ageDaysFloor,
  ageHours,
  classifyAge,
  classifyAgingInput,
  composeAgingBriefCallouts,
  formatAgeShort,
  renderAgingCalloutText,
  selectTopAging,
  sortAging,
  type AgingItem,
} from "../sales-aging";

const NOW = new Date("2026-04-25T18:00:00Z");

function isoHoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// ageHours / ageDays / ageDaysFloor
// ---------------------------------------------------------------------------

describe("ageHours / ageDays / ageDaysFloor", () => {
  it("computes hours between an ISO and now", () => {
    expect(ageHours(isoHoursAgo(3), NOW)).toBeCloseTo(3, 5);
    expect(ageHours(isoHoursAgo(48), NOW)).toBeCloseTo(48, 5);
  });

  it("returns null for missing / empty / undefined inputs", () => {
    expect(ageHours(undefined, NOW)).toBeNull();
    expect(ageHours(null, NOW)).toBeNull();
    expect(ageHours("", NOW)).toBeNull();
    expect(ageHours("   ", NOW)).toBeNull();
  });

  it("returns null for unparseable ISO strings (no fabricated age)", () => {
    expect(ageHours("not-a-date", NOW)).toBeNull();
    expect(ageHours("2026-13-99", NOW)).toBeNull();
  });

  it("returns null for future-dated anchors (treats as data gap)", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    expect(ageHours(future, NOW)).toBeNull();
  });

  it("ageDays = ageHours/24, returns null when ageHours returns null", () => {
    expect(ageDays(isoHoursAgo(48), NOW)).toBeCloseTo(2, 5);
    expect(ageDays("nope", NOW)).toBeNull();
  });

  it("ageDaysFloor floors so 9.7d reads as 9d (no over-statement)", () => {
    expect(ageDaysFloor(isoHoursAgo(9 * 24 + 16), NOW)).toBe(9);
    expect(ageDaysFloor("nope", NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyAge — threshold registry
// ---------------------------------------------------------------------------

describe("classifyAge — per-source thresholds", () => {
  it("approvals: <4h fresh, >=4h watch, >=24h overdue, >=48h critical", () => {
    const t = AGING_THRESHOLDS["approval"];
    expect(classifyAge(0, t)).toBe("fresh");
    expect(classifyAge(3.99, t)).toBe("fresh");
    expect(classifyAge(4, t)).toBe("watch");
    expect(classifyAge(23.99, t)).toBe("watch");
    expect(classifyAge(24, t)).toBe("overdue");
    expect(classifyAge(47.99, t)).toBe("overdue");
    expect(classifyAge(48, t)).toBe("critical");
    expect(classifyAge(200, t)).toBe("critical");
  });

  it("faire-followup: 3d watch / 7d overdue / 14d critical", () => {
    const t = AGING_THRESHOLDS["faire-followup"];
    expect(classifyAge(48, t)).toBe("fresh"); // 2d
    expect(classifyAge(72, t)).toBe("watch"); // 3d
    expect(classifyAge(167.99, t)).toBe("watch");
    expect(classifyAge(168, t)).toBe("overdue"); // 7d
    expect(classifyAge(335.99, t)).toBe("overdue");
    expect(classifyAge(336, t)).toBe("critical"); // 14d
  });

  it("location-draft: 7d watch / 14d overdue / 21d critical", () => {
    const t = AGING_THRESHOLDS["location-draft"];
    expect(classifyAge(167, t)).toBe("fresh");
    expect(classifyAge(168, t)).toBe("watch");
    expect(classifyAge(336, t)).toBe("overdue");
    expect(classifyAge(504, t)).toBe("critical");
  });

  it("receipt: 2d watch / 7d overdue / 14d critical", () => {
    const t = AGING_THRESHOLDS["receipt"];
    expect(classifyAge(47, t)).toBe("fresh");
    expect(classifyAge(48, t)).toBe("watch");
    expect(classifyAge(168, t)).toBe("overdue");
    expect(classifyAge(336, t)).toBe("critical");
  });

  it("AP packets are intentionally absent from the threshold registry — caller must surface them as missing-timestamp", () => {
    // Type-level: AGING_THRESHOLDS keyed on Exclude<…, "ap-packet">.
    // Runtime: the key shouldn't exist either.
    expect(
      Object.prototype.hasOwnProperty.call(
        AGING_THRESHOLDS,
        "ap-packet",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyAgingInput — projects rows or surfaces missing timestamps
// ---------------------------------------------------------------------------

describe("classifyAgingInput", () => {
  it("classifies a present anchor into ageHours + tier", () => {
    const r = classifyAgingInput(
      {
        source: "approval",
        id: "appr-1",
        label: "Test approval",
        link: "/ops/sales",
        anchorAt: isoHoursAgo(36),
      },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item.tier).toBe("overdue");
    expect(r.item.ageHours).toBeCloseTo(36, 5);
    expect(r.item.ageDays).toBeCloseTo(1.5, 5);
  });

  it("missing anchor → MissingTimestampItem (NOT a fabricated age=0)", () => {
    const r = classifyAgingInput(
      {
        source: "approval",
        id: "appr-2",
        label: "No timestamp",
        link: "/ops/sales",
        anchorAt: undefined,
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.reason).toMatch(/no anchor timestamp/i);
  });

  it("unparseable anchor → MissingTimestampItem with the raw string surfaced honestly", () => {
    const r = classifyAgingInput(
      {
        source: "receipt",
        id: "r-1",
        label: "Bad date receipt",
        link: "/ops/finance/review",
        anchorAt: "not-a-date",
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.reason).toContain("not-a-date");
    expect(r.missing.reason).toMatch(/unparseable|future/i);
  });

  it("future anchor → MissingTimestampItem (no negative-age fabrication)", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    const r = classifyAgingInput(
      {
        source: "location-draft",
        id: "d-1",
        label: "Future draft",
        link: "/ops/locations",
        anchorAt: future,
      },
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sortAging / selectTopAging
// ---------------------------------------------------------------------------

function mkItem(
  source: AgingItem["source"],
  ageH: number,
  tier: AgingItem["tier"],
  id = `${source}-${ageH}`,
): AgingItem {
  return {
    source,
    id,
    label: `${source} ${id}`,
    link: "/ops/sales",
    anchorAt: isoHoursAgo(ageH),
    ageHours: ageH,
    ageDays: ageH / 24,
    tier,
  };
}

describe("sortAging / selectTopAging", () => {
  it("sorts critical → overdue → watch → fresh, oldest-first within tier", () => {
    const sorted = sortAging([
      mkItem("approval", 5, "watch", "w-young"),
      mkItem("approval", 100, "critical", "c-young"),
      mkItem("approval", 200, "critical", "c-old"),
      mkItem("approval", 30, "overdue", "o-young"),
      mkItem("approval", 40, "overdue", "o-old"),
      mkItem("approval", 1, "fresh", "f-1"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual([
      "c-old",
      "c-young",
      "o-old",
      "o-young",
      "w-young",
      "f-1",
    ]);
  });

  it("selectTopAging filters out fresh by default + caps to limit", () => {
    const top = selectTopAging(
      [
        mkItem("approval", 100, "critical", "c1"),
        mkItem("approval", 30, "overdue", "o1"),
        mkItem("approval", 5, "watch", "w1"),
        mkItem("approval", 1, "fresh", "f1"),
        mkItem("approval", 0.5, "fresh", "f2"),
      ],
      2,
    );
    expect(top.map((i) => i.id)).toEqual(["c1", "o1"]);
  });

  it("selectTopAging includes fresh rows when explicitly requested", () => {
    const top = selectTopAging(
      [
        mkItem("approval", 100, "critical", "c1"),
        mkItem("approval", 1, "fresh", "f1"),
      ],
      10,
      { includeFresh: true },
    );
    expect(top.map((i) => i.id)).toEqual(["c1", "f1"]);
  });

  it("limit=0 returns an empty list (defensive)", () => {
    expect(
      selectTopAging([mkItem("approval", 100, "critical")], 0),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// composeAgingBriefCallouts — bounded morning-brief callouts
// ---------------------------------------------------------------------------

describe("composeAgingBriefCallouts", () => {
  it("caps at 3 callouts by default, critical-first", () => {
    const callouts = composeAgingBriefCallouts([
      mkItem("approval", 100, "critical", "c1"),
      mkItem("faire-followup", 200, "critical", "c2"),
      mkItem("location-draft", 300, "critical", "c3"),
      mkItem("receipt", 400, "critical", "c4"), // would be #4 — must be dropped
    ]);
    expect(callouts).toHaveLength(3);
    expect(callouts.every((c) => c.tier === "critical")).toBe(true);
  });

  it("never includes fresh rows even when there's no actionable signal", () => {
    const callouts = composeAgingBriefCallouts([
      mkItem("approval", 1, "fresh", "f1"),
      mkItem("approval", 2, "fresh", "f2"),
    ]);
    expect(callouts).toEqual([]);
  });

  it("respects custom maxCallouts", () => {
    const callouts = composeAgingBriefCallouts(
      [
        mkItem("approval", 100, "critical", "c1"),
        mkItem("faire-followup", 200, "critical", "c2"),
      ],
      { maxCallouts: 1 },
    );
    expect(callouts).toHaveLength(1);
    expect(callouts[0].source).toBe("faire-followup"); // older critical wins
  });

  it("sort priority is critical before overdue before watch", () => {
    const callouts = composeAgingBriefCallouts([
      mkItem("approval", 5, "watch", "w1"),
      mkItem("approval", 100, "critical", "c1"),
      mkItem("approval", 30, "overdue", "o1"),
    ]);
    expect(callouts.map((c) => c.tier)).toEqual([
      "critical",
      "overdue",
      "watch",
    ]);
  });

  it("rendered text follows the locked format with badge + source + age + label", () => {
    const callouts = composeAgingBriefCallouts([
      mkItem("approval", 51, "critical", "appr-1"),
    ]);
    expect(callouts[0].text).toMatch(/CRITICAL/);
    expect(callouts[0].text).toMatch(/Slack approval/);
    // formatAgeShort renders >=48h as days, so 51h reads as "2d".
    expect(callouts[0].text).toMatch(/2d/);
    expect(callouts[0].text).toContain("approval appr-1");
  });
});

// ---------------------------------------------------------------------------
// formatAgeShort / renderAgingCalloutText
// ---------------------------------------------------------------------------

describe("formatAgeShort", () => {
  it("renders <48h as 'Nh' and >=48h as 'Nd'", () => {
    expect(formatAgeShort(3)).toBe("3h");
    expect(formatAgeShort(47.9)).toBe("47h");
    expect(formatAgeShort(48)).toBe("2d");
    expect(formatAgeShort(120)).toBe("5d");
  });
});

describe("renderAgingCalloutText", () => {
  it("formats label + age + source label per tier", () => {
    const item = mkItem("location-draft", 360, "critical", "Tasty Foods Co");
    const t = renderAgingCalloutText(item);
    expect(t).toContain("CRITICAL");
    expect(t).toContain("Retail draft");
    expect(t).toContain("15d");
  });

  it("renders fresh rows without a tier badge (defensive — fresh shouldn't reach a callout)", () => {
    const item = mkItem("approval", 1, "fresh", "fresh-1");
    const t = renderAgingCalloutText(item);
    expect(t).not.toContain("CRITICAL");
    expect(t).not.toContain("WATCH");
    expect(t).not.toContain("OVERDUE");
  });
});

// ---------------------------------------------------------------------------
// Read-only / no-mutation invariant
// ---------------------------------------------------------------------------

describe("read-only invariants", () => {
  it("sortAging does not mutate the input array", () => {
    const input = [
      mkItem("approval", 5, "watch", "w1"),
      mkItem("approval", 100, "critical", "c1"),
    ];
    const before = input.map((i) => i.id);
    sortAging(input);
    expect(input.map((i) => i.id)).toEqual(before);
  });

  it("selectTopAging does not mutate the input array", () => {
    const input = [
      mkItem("approval", 100, "critical", "c1"),
      mkItem("approval", 5, "watch", "w1"),
      mkItem("approval", 1, "fresh", "f1"),
    ];
    const before = [...input];
    selectTopAging(input, 2);
    expect(input).toEqual(before);
  });

  it("composeAgingBriefCallouts does not mutate the input array", () => {
    const input = [
      mkItem("approval", 100, "critical", "c1"),
      mkItem("approval", 5, "watch", "w1"),
    ];
    const before = [...input];
    composeAgingBriefCallouts(input);
    expect(input).toEqual(before);
  });
});
