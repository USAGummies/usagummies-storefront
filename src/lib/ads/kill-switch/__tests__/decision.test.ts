import { describe, expect, it } from "vitest";

import {
  decideKillSwitch,
  DEFAULT_KILL_SPEND_USD,
  DEFAULT_WARN_SPEND_USD,
  type AdSpendSnapshot,
} from "../decision";

function meta(spend: number, conversions: number): AdSpendSnapshot {
  return {
    platform: "meta",
    available: true,
    spendUsd: spend,
    conversions,
  };
}

function google(spend: number, conversions: number): AdSpendSnapshot {
  return {
    platform: "google",
    available: true,
    spendUsd: spend,
    conversions,
  };
}

function unavailable(
  platform: "meta" | "google",
  reason: string,
): AdSpendSnapshot {
  return {
    platform,
    available: false,
    spendUsd: null,
    conversions: null,
    unavailableReason: reason,
  };
}

describe("decideKillSwitch — kill threshold", () => {
  it("flags KILL when spend > $100 with zero conversions", () => {
    const d = decideKillSwitch([
      meta(150, 0),
      google(0, 0),
    ]);
    expect(d.overallSeverity).toBe("kill");
    expect(d.shouldKill).toBe(true);
    expect(d.perPlatform[0].severity).toBe("kill");
    expect(d.perPlatform[0].reason).toContain("150.00");
    expect(d.perPlatform[0].reason).toContain("zero conversions");
  });

  it("flags KILL on either platform — Google triggers, Meta is healthy", () => {
    const d = decideKillSwitch([
      meta(20, 5),
      google(120, 0),
    ]);
    expect(d.overallSeverity).toBe("kill");
    expect(d.shouldKill).toBe(true);
    expect(d.perPlatform[0].severity).toBe("ok");
    expect(d.perPlatform[1].severity).toBe("kill");
  });

  it("real Sept-Apr Google leak shape ($95/wk → $13/d → 0 conv) → does NOT kill at daily cadence", () => {
    // The historical leak pattern was actually below the $100/day
    // threshold per-day. The kill switch catches the day-1
    // misconfig (e.g. $1,678 in a single day) — for the slow-leak
    // case the WARN tier fires instead, which is correct shape.
    const d = decideKillSwitch([
      meta(0, 0),
      google(13, 0),
    ]);
    expect(d.overallSeverity).toBe("ok");
  });

  it("flags KILL when single-day spike matches the $1,678 pattern", () => {
    // Real-world example: a single-day misconfig burn.
    const d = decideKillSwitch([
      meta(0, 0),
      google(1678, 0),
    ]);
    expect(d.overallSeverity).toBe("kill");
    expect(d.shouldKill).toBe(true);
  });

  it("DOES NOT kill at exactly $100 (must be > threshold)", () => {
    const d = decideKillSwitch([
      meta(DEFAULT_KILL_SPEND_USD, 0),
      google(0, 0),
    ]);
    expect(d.perPlatform[0].severity).toBe("warn");
  });

  it("DOES NOT kill when conversions > 0 even at high spend", () => {
    const d = decideKillSwitch([
      meta(500, 1), // $500 / 1 = $500 CPA — flags warn (CPA), not kill
      google(0, 0),
    ]);
    expect(d.perPlatform[0].severity).toBe("warn");
    expect(d.shouldKill).toBe(false);
  });
});

describe("decideKillSwitch — warn tier", () => {
  it("flags WARN when spend > $50 with zero conversions (below kill threshold)", () => {
    const d = decideKillSwitch([
      meta(75, 0),
      google(0, 0),
    ]);
    expect(d.overallSeverity).toBe("warn");
    expect(d.perPlatform[0].severity).toBe("warn");
    expect(d.perPlatform[0].reason).toContain("75.00");
  });

  it("flags WARN when CPA > $50", () => {
    const d = decideKillSwitch([
      meta(60, 1), // $60 spend / 1 conv = $60 CPA
      google(0, 0),
    ]);
    expect(d.perPlatform[0].severity).toBe("warn");
    expect(d.perPlatform[0].cpaUsd).toBe(60);
    expect(d.perPlatform[0].reason).toContain("CPA $60.00");
  });

  it("DOES NOT warn at exactly $50 (must be > threshold)", () => {
    const d = decideKillSwitch([
      meta(DEFAULT_WARN_SPEND_USD, 0),
      google(0, 0),
    ]);
    expect(d.perPlatform[0].severity).toBe("ok");
  });

  it("DOES NOT warn when CPA <= $50", () => {
    const d = decideKillSwitch([
      meta(50, 1), // $50 CPA exactly — at threshold, not above
      google(0, 0),
    ]);
    expect(d.perPlatform[0].severity).toBe("ok");
  });

  it("worst-case rule: kill on one platform overrides warn on other", () => {
    const d = decideKillSwitch([
      meta(75, 0), // warn
      google(150, 0), // kill
    ]);
    expect(d.overallSeverity).toBe("kill");
    expect(d.shouldKill).toBe(true);
  });
});

describe("decideKillSwitch — healthy + unavailable", () => {
  it("returns OK when both platforms healthy", () => {
    const d = decideKillSwitch([
      meta(40, 3),
      google(35, 2),
    ]);
    expect(d.overallSeverity).toBe("ok");
    expect(d.shouldKill).toBe(false);
    expect(d.totalSpendUsd).toBe(75);
    expect(d.totalConversions).toBe(5);
  });

  it("treats unavailable as OK (per-platform) but surfaces unavailableReason", () => {
    const d = decideKillSwitch([
      meta(40, 2),
      unavailable("google", "GOOGLE_ADS_* envs not configured"),
    ]);
    expect(d.overallSeverity).toBe("ok");
    expect(d.perPlatform[1].severity).toBe("ok");
    expect(d.perPlatform[1].unavailableReason).toContain(
      "GOOGLE_ADS_* envs not configured",
    );
  });

  it("aggregates totals only across available platforms", () => {
    const d = decideKillSwitch([
      meta(40, 2),
      unavailable("google", "fetch failed"),
    ]);
    expect(d.totalSpendUsd).toBe(40);
    expect(d.totalConversions).toBe(2);
  });

  it("custom thresholds — caller can lower the kill bar to $20", () => {
    const d = decideKillSwitch(
      [meta(25, 0), google(0, 0)],
      { killSpendUsd: 20 },
    );
    expect(d.overallSeverity).toBe("kill");
    expect(d.perPlatform[0].severity).toBe("kill");
  });
});
