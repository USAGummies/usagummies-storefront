import { describe, expect, it } from "vitest";

import {
  buildSalesPipelineSummary,
  renderSalesPipelineBriefLine,
} from "../sales-pipeline";

describe("buildSalesPipelineSummary", () => {
  it("computes open deal count without closed-won/lost stages", () => {
    const summary = buildSalesPipelineSummary({
      stages: [
        { id: "lead", name: "Lead", count: 2 },
        { id: "sample", name: "Sample Shipped", count: 3 },
        { id: "won", name: "Closed Won", count: 10 },
        { id: "lost", name: "Closed Lost", count: 4 },
      ],
      staleSampleShipped: [],
      openCallTasks: [],
    });
    expect(summary.openDealCount).toBe(5);
  });

  it("does not inflate malformed or negative stage counts", () => {
    const summary = buildSalesPipelineSummary({
      stages: [
        { id: "lead", name: "Lead", count: Number.NaN },
        { id: "contacted", name: "Contacted", count: -3 },
        { id: "sample", name: "Sample Shipped", count: 2.9 },
      ],
      staleSampleShipped: [],
      openCallTasks: [],
    });
    expect(summary.stages.map((s) => s.count)).toEqual([0, 0, 2]);
    expect(summary.openDealCount).toBe(2);
  });

  it("caps stale deal and call task previews without changing totals", () => {
    const stale = Array.from({ length: 8 }, (_, i) => ({
      id: `deal-${i}`,
      dealname: `Deal ${i}`,
      lastModifiedAt: "2026-04-01T00:00:00.000Z",
    }));
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `task-${i}`,
      subject: `Call ${i}`,
      priority: i === 0 ? "HIGH" : null,
      dueAt: null,
    }));
    const summary = buildSalesPipelineSummary({
      stages: [],
      staleSampleShipped: stale,
      openCallTasks: tasks,
      previewLimit: 3,
    });
    expect(summary.staleSampleShipped.total).toBe(8);
    expect(summary.staleSampleShipped.preview).toHaveLength(3);
    expect(summary.openCallTasks.total).toBe(7);
    expect(summary.openCallTasks.preview).toHaveLength(3);
  });

  it("renders a compact brief line from the summary", () => {
    const summary = buildSalesPipelineSummary({
      stages: [{ id: "lead", name: "Lead", count: 4 }],
      staleSampleShipped: [{ id: "d1", dealname: "A", lastModifiedAt: null }],
      openCallTasks: [{ id: "t1", subject: "Call", priority: "HIGH", dueAt: null }],
    });
    expect(renderSalesPipelineBriefLine(summary)).toBe(
      "B2B pipeline: 4 open deals · 1 stale samples · 1 call tasks",
    );
  });
});

