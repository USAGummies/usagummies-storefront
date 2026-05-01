import { describe, expect, it } from "vitest";

import {
  buildSalesCommandCenter,
  sourceWired,
  type SalesCommandCenterInput,
} from "../sales-command-center";
import { renderSalesCommandCenterSlack } from "../slack-command-center";

function input(): SalesCommandCenterInput {
  return {
    faireInvites: sourceWired({
      needs_review: 2,
      approved: 1,
      sent: 3,
      rejected: 0,
      total: 6,
    }),
    faireFollowUps: sourceWired({
      counts: { overdue: 1, due_soon: 2, not_due: 4, sent_total: 7 },
      actionable: [],
    }),
    pendingApprovals: sourceWired({
      total: 5,
      byTargetType: { "email-reply": 3 },
      preview: [],
    }),
    apPackets: sourceWired({
      total: 1,
      ready_to_send: 0,
      action_required: 1,
      sent: 0,
    }),
    locationDrafts: sourceWired({
      needs_review: 4,
      accepted: 1,
      rejected: 0,
      total: 5,
    }),
    wholesaleInquiries: sourceWired({ total: 8 }),
    revenueChannels: [
      {
        channel: "shopify",
        status: "wired",
        amountUsd: 1000,
        source: { system: "shopify", retrievedAt: "2026-05-01T12:00:00.000Z" },
      },
    ],
    agingItems: [
      {
        source: "approval",
        id: "appr-1",
        label: "Send buyer reply",
        link: "/ops/sales",
        anchorAt: "2026-04-29T12:00:00.000Z",
        ageHours: 48,
        ageDays: 2,
        tier: "critical",
      },
    ],
  };
}

describe("renderSalesCommandCenterSlack", () => {
  it("renders a compact operator dashboard with links and no raw dump labels", () => {
    const report = buildSalesCommandCenter(input(), {
      now: new Date("2026-05-01T12:00:00.000Z"),
    });
    const message = renderSalesCommandCenterSlack(report);
    const json = JSON.stringify(message.blocks);

    expect(message.text).toContain("USA Gummies Command Center");
    expect(json).toContain("Revenue last 7d");
    expect(json).toContain("Approvals");
    expect(json).toContain("Top aging risks");
    expect(json).toContain("Open Sales Command");
    expect(json).toContain("https://www.usagummies.com/ops/sales");
    expect(json).not.toContain("payloadPreview");
    expect(json).not.toContain("raw");
  });

  it("surfaces not-wired counts honestly instead of rendering them as zero", () => {
    const base = input();
    const report = buildSalesCommandCenter({
      ...base,
      pendingApprovals: { status: "not_wired", reason: "approval store down" },
    }, {
      now: new Date("2026-05-01T12:00:00.000Z"),
    });
    const message = renderSalesCommandCenterSlack(report);
    expect(JSON.stringify(message.blocks)).toContain("not wired");
  });
});
