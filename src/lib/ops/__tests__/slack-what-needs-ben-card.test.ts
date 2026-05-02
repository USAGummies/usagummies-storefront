/**
 * Slack `what needs ben` card renderer coverage.
 *
 * Pins:
 *   - Green posture renders "clean across all lanes" header.
 *   - Recommendation text appears in the top section.
 *   - All 6 lanes render with chip + summary + slashCommand.
 *   - Counts block surfaces red/yellow/green/unknown.
 *   - Read-only context note ("no execution fires from this card") present.
 *   - Dashboard URL is /ops/today.
 *   - Degraded list surfaces in context block.
 *   - Unknown overall posture renders "some lanes unavailable".
 */
import { describe, expect, it } from "vitest";

import { renderWhatNeedsBenCard } from "../slack-what-needs-ben-card";
import type { WhatNeedsBenSummary } from "../what-needs-ben";

function summary(
  overrides: Partial<WhatNeedsBenSummary> = {},
): WhatNeedsBenSummary {
  return {
    generatedAt: "2026-05-02T18:00:00.000Z",
    posture: "green",
    lanes: [
      {
        id: "shipping",
        label: "Shipping",
        posture: "green",
        summary: "clean",
        slashCommand: "shipping today",
        degraded: false,
      },
      {
        id: "finance",
        label: "Finance",
        posture: "green",
        summary: "clean",
        slashCommand: "finance today",
        degraded: false,
      },
      {
        id: "email",
        label: "Email",
        posture: "green",
        summary: "queue empty",
        slashCommand: "email queue",
        degraded: false,
      },
      {
        id: "sales",
        label: "Sales",
        posture: "green",
        summary: "clean",
        slashCommand: "ops today",
        degraded: false,
      },
      {
        id: "proposals",
        label: "Proposals",
        posture: "green",
        summary: "0 queued",
        slashCommand: "proposals",
        degraded: false,
      },
      {
        id: "marketing",
        label: "Marketing",
        posture: "green",
        summary: "no platforms configured",
        slashCommand: "marketing today",
        degraded: false,
      },
    ],
    recommendation: {
      laneId: null,
      text: "Clean across all lanes — no action needed.",
    },
    counts: { red: 0, yellow: 0, green: 6, unknown: 0 },
    degraded: [],
    ...overrides,
  };
}

describe("renderWhatNeedsBenCard", () => {
  it("green posture → clean copy in header + top text", () => {
    const card = renderWhatNeedsBenCard({ summary: summary() });
    expect(card.text).toMatch(/clean across all lanes/i);
    expect(JSON.stringify(card.blocks)).toMatch(/🟢 clean/);
    expect(JSON.stringify(card.blocks)).toMatch(/Clean across all lanes/);
  });

  it("recommendation text appears in the top section", () => {
    const card = renderWhatNeedsBenCard({
      summary: summary({
        posture: "red",
        recommendation: {
          laneId: "shipping",
          text: "🚨 Start with *Shipping* — 1 exhausted. Run `shipping today`.",
        },
        counts: { red: 1, yellow: 0, green: 5, unknown: 0 },
        lanes: summary().lanes.map((l) =>
          l.id === "shipping"
            ? {
                ...l,
                posture: "red",
                summary: "1 exhausted",
              }
            : l,
        ),
      }),
    });
    expect(JSON.stringify(card.blocks)).toMatch(/🚨 Start with \*Shipping\*/);
  });

  it("all 6 lanes render with chip + label + slashCommand", () => {
    const card = renderWhatNeedsBenCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/Shipping/);
    expect(blob).toMatch(/Finance/);
    expect(blob).toMatch(/Email/);
    expect(blob).toMatch(/Sales/);
    expect(blob).toMatch(/Proposals/);
    expect(blob).toMatch(/Marketing/);
    expect(blob).toContain("`shipping today`");
    expect(blob).toContain("`finance today`");
    expect(blob).toContain("`email queue`");
    expect(blob).toContain("`ops today`");
    expect(blob).toContain("`proposals`");
    expect(blob).toContain("`marketing today`");
  });

  it("counts block renders red/yellow/green/unknown chips", () => {
    const card = renderWhatNeedsBenCard({
      summary: summary({
        posture: "red",
        counts: { red: 1, yellow: 2, green: 2, unknown: 1 },
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/🔴 1/);
    expect(blob).toMatch(/🟡 2/);
    expect(blob).toMatch(/🟢 2/);
    expect(blob).toMatch(/⚪️ 1/);
  });

  it("read-only context note + dashboard URL present", () => {
    const card = renderWhatNeedsBenCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no execution fires from this card/i);
    expect(blob).toContain("/ops/today");
  });

  it("unknown overall posture renders 'some lanes unavailable'", () => {
    const card = renderWhatNeedsBenCard({
      summary: summary({
        posture: "unknown",
        counts: { red: 0, yellow: 0, green: 5, unknown: 1 },
      }),
    });
    expect(card.text).toMatch(/some lanes unavailable/i);
  });

  it("degraded list surfaces in context", () => {
    const card = renderWhatNeedsBenCard({
      summary: summary({ degraded: ["email: kv-down"] }),
    });
    expect(JSON.stringify(card.blocks)).toContain("email: kv-down");
  });

  it("lane chip color comes from posture (red lane shows 🔴)", () => {
    const card = renderWhatNeedsBenCard({
      summary: summary({
        posture: "red",
        counts: { red: 1, yellow: 0, green: 5, unknown: 0 },
        lanes: summary().lanes.map((l) =>
          l.id === "shipping"
            ? { ...l, posture: "red", summary: "1 exhausted" }
            : l,
        ),
      }),
    });
    const blob = JSON.stringify(card.blocks);
    // Find shipping field — it should have 🔴
    expect(blob).toMatch(/🔴 \*Shipping\*/);
  });
});
