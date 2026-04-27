/**
 * Phase 30.2 — Inventory reorder trigger helpers.
 *
 * Locks the contract:
 *   - pickReorderCandidates includes ONLY urgent + soon, sorts
 *     urgent-first then ascending coverDays, caps at limit.
 *   - dedup keys are `inventory-reorder:alert:<sku-lower>:<YYYY-MM-DD>`.
 *   - renderReorderSlackMessage emits "" on empty (quiet collapse).
 *   - partitionAlreadyAlerted splits cleanly via predicate.
 */
import { describe, expect, it } from "vitest";

import type { CoverDaysForecast, CoverDaysRow } from "../inventory-forecast";
import {
  buildReorderDedupKey,
  formatYmdUtc,
  partitionAlreadyAlerted,
  pickReorderCandidates,
  renderReorderSlackMessage,
  type ReorderCandidate,
} from "../inventory-reorder-trigger";

function row(
  sku: string,
  coverDays: number | null,
  urgency: CoverDaysRow["urgency"],
  onHand = 100,
): CoverDaysRow {
  return {
    sku,
    productTitle: sku,
    variantTitle: "",
    onHand,
    burnRatePerDay: 250,
    coverDays,
    urgency,
    expectedStockoutDate: null,
  };
}

function forecast(rows: CoverDaysRow[]): CoverDaysForecast {
  return {
    generatedAt: "2026-04-27T16:00:00.000Z",
    defaultBurnRate: 250,
    burnRateSource: "default",
    totalOnHand: rows.reduce((s, r) => s + r.onHand, 0),
    totalBurnRate: rows.length * 250,
    fleetCoverDays: 30,
    rows,
    reorderRecommended: rows.filter(
      (r) => r.urgency === "urgent" || r.urgency === "soon",
    ),
  };
}

describe("formatYmdUtc + buildReorderDedupKey", () => {
  it("formats UTC date as YYYY-MM-DD regardless of TZ", () => {
    // Always slices the ISO string, so no TZ leak.
    expect(formatYmdUtc(new Date("2026-04-27T23:59:59.000Z"))).toBe(
      "2026-04-27",
    );
    expect(formatYmdUtc(new Date("2026-04-28T00:00:00.000Z"))).toBe(
      "2026-04-28",
    );
  });

  it("dedup key lowercases the SKU and embeds the day", () => {
    expect(buildReorderDedupKey("USG-FBM-1PK", "2026-04-27")).toBe(
      "inventory-reorder:alert:usg-fbm-1pk:2026-04-27",
    );
  });
});

describe("pickReorderCandidates", () => {
  const now = new Date("2026-04-27T16:00:00.000Z");

  it("includes only urgent + soon — drops ok and unknown", () => {
    const f = forecast([
      row("A", 10, "urgent"),
      row("B", 25, "soon"),
      row("C", 60, "ok"),
      row("D", null, "unknown"),
    ]);
    const got = pickReorderCandidates(f, { now });
    expect(got.map((c) => c.sku)).toEqual(["A", "B"]);
  });

  it("sorts urgent-first, then by ascending coverDays within tier", () => {
    const f = forecast([
      row("SOON-LOW", 22, "soon"),
      row("URG-HIGH", 13, "urgent"),
      row("URG-LOW", 5, "urgent"),
      row("SOON-HIGH", 28, "soon"),
    ]);
    const got = pickReorderCandidates(f, { now });
    expect(got.map((c) => c.sku)).toEqual([
      "URG-LOW",
      "URG-HIGH",
      "SOON-LOW",
      "SOON-HIGH",
    ]);
  });

  it("respects the limit cap (urgent prioritized into the cap)", () => {
    const f = forecast([
      row("U1", 4, "urgent"),
      row("U2", 6, "urgent"),
      row("S1", 22, "soon"),
      row("S2", 28, "soon"),
    ]);
    const got = pickReorderCandidates(f, { now, limit: 2 });
    expect(got).toHaveLength(2);
    expect(got.map((c) => c.sku)).toEqual(["U1", "U2"]);
  });

  it("dedup keys embed the SKU + day for each candidate", () => {
    const f = forecast([row("Z-9", 3, "urgent")]);
    const [c] = pickReorderCandidates(f, { now });
    expect(c.dedupKey).toBe("inventory-reorder:alert:z-9:2026-04-27");
  });

  it("empty forecast → empty candidates (no fabrication)", () => {
    const f = forecast([]);
    expect(pickReorderCandidates(f, { now })).toEqual([]);
  });
});

describe("renderReorderSlackMessage", () => {
  const f = forecast([row("A", 5, "urgent"), row("B", 25, "soon")]);

  it("empty list → empty string (quiet collapse)", () => {
    expect(renderReorderSlackMessage([], f)).toBe("");
  });

  it("renders headline with count + urgent count", () => {
    const candidates = pickReorderCandidates(f);
    const msg = renderReorderSlackMessage(candidates, f);
    expect(msg).toContain("Reorder watch");
    expect(msg).toContain("2 SKUs");
    expect(msg).toContain("(1 urgent)");
  });

  it("formats SKU bullets with cover days, urgency, on-hand, burn rate", () => {
    const candidates = pickReorderCandidates(f);
    const msg = renderReorderSlackMessage(candidates, f);
    expect(msg).toContain("• A — *5.0 days* (urgent");
    expect(msg).toContain("• B — *25.0 days* (soon");
    expect(msg).toContain("on hand");
    expect(msg).toContain("/day");
  });

  it("recommends qbo.po.draft Class B Ben — keeps the doctrinal direction", () => {
    const candidates = pickReorderCandidates(f);
    const msg = renderReorderSlackMessage(candidates, f);
    expect(msg).toContain("qbo.po.draft");
    expect(msg).toContain("Class B");
    expect(msg).toContain("Ben");
  });

  it("does NOT recommend Drew (post-Phase 29 doctrine)", () => {
    const candidates = pickReorderCandidates(f);
    const msg = renderReorderSlackMessage(candidates, f);
    // Drew is not an approver; the message must not even hint.
    expect(msg).not.toContain("Drew");
  });
});

describe("partitionAlreadyAlerted", () => {
  it("splits candidates into fresh + alreadyAlerted using predicate", () => {
    const candidates: ReorderCandidate[] = [
      {
        ...row("A", 5, "urgent"),
        dedupKey: "k:a",
      },
      {
        ...row("B", 22, "soon"),
        dedupKey: "k:b",
      },
      {
        ...row("C", 28, "soon"),
        dedupKey: "k:c",
      },
    ];
    const alerted = new Set(["k:b"]);
    const { fresh, alreadyAlerted } = partitionAlreadyAlerted(
      candidates,
      (k) => alerted.has(k),
    );
    expect(fresh.map((c) => c.sku)).toEqual(["A", "C"]);
    expect(alreadyAlerted.map((c) => c.sku)).toEqual(["B"]);
  });

  it("empty input → empty partitions", () => {
    const r = partitionAlreadyAlerted([], () => false);
    expect(r.fresh).toEqual([]);
    expect(r.alreadyAlerted).toEqual([]);
  });

  it("predicate returns true for every key → all alreadyAlerted", () => {
    const candidates: ReorderCandidate[] = [
      { ...row("A", 5, "urgent"), dedupKey: "k:a" },
    ];
    const r = partitionAlreadyAlerted(candidates, () => true);
    expect(r.fresh).toEqual([]);
    expect(r.alreadyAlerted).toHaveLength(1);
  });
});
