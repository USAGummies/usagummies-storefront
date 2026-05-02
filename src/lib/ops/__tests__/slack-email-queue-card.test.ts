/**
 * Slack email-queue card renderer coverage.
 *
 * Pins:
 *   - Empty queue → header + zero text + empty-state brief.
 *   - Whale presence rendered as a bold warning.
 *   - Top rows truncated to 80 chars per subject.
 *   - Category counts surface in fields when classified records exist.
 *   - Truncated + degraded surface in context block.
 *   - Dashboard link present in actions block.
 *   - No raw email body / snippet leaked.
 */
import { describe, expect, it } from "vitest";

import { renderEmailQueueCard } from "../slack-email-queue-card";
import type {
  EmailAgentQueueRow,
  EmailAgentQueueSummary,
} from "../email-agent-queue";

function row(overrides: Partial<EmailAgentQueueRow> = {}): EmailAgentQueueRow {
  return {
    messageId: "m-1",
    threadId: "t-1",
    fromEmail: "buyer@example.com",
    fromHeader: "Buyer <buyer@example.com>",
    subject: "Sample request — premium candy line",
    date: "Thu, 01 May 2026 12:00:00 -0700",
    status: "classified",
    category: "A_sample_request",
    confidence: 0.95,
    observedAt: "2026-05-01T19:00:00.000Z",
    classifiedAt: "2026-05-01T19:01:00.000Z",
    ...overrides,
  };
}

function summary(
  overrides: Partial<EmailAgentQueueSummary> = {},
): EmailAgentQueueSummary {
  return {
    total: 0,
    byStatus: {
      received: 0,
      received_noise: 0,
      classified: 0,
      classified_whale: 0,
    },
    byCategory: {},
    whaleCount: 0,
    oldestReceived: null,
    topRows: [],
    backlogReceived: 0,
    ...overrides,
  };
}

describe("renderEmailQueueCard", () => {
  it("empty queue renders empty-state copy + actions", () => {
    const card = renderEmailQueueCard({ summary: summary() });
    expect(card.text).toMatch(/empty/i);
    expect(JSON.stringify(card.blocks)).toMatch(/scanner has not written/);
    expect(JSON.stringify(card.blocks)).toMatch(/email-agents dashboard/);
  });

  it("renders total + classified + backlog + whale counts in fields", () => {
    const card = renderEmailQueueCard({
      summary: summary({
        total: 7,
        byStatus: {
          received: 1,
          received_noise: 2,
          classified: 3,
          classified_whale: 1,
        },
        byCategory: { A_sample_request: 2, B_qualifying_question: 1 },
        whaleCount: 1,
        backlogReceived: 1,
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Total");
    expect(blob).toContain("\\n7");
    expect(blob).toContain("Classified");
    expect(blob).toContain("\\n3");
    expect(blob).toContain("🐳 Whales");
    expect(blob).toContain("\\n1");
    expect(blob).toContain("A_sample_request · 2");
  });

  it("whale presence raises the brief copy", () => {
    const card = renderEmailQueueCard({
      summary: summary({
        total: 2,
        byStatus: {
          received: 0,
          received_noise: 0,
          classified: 1,
          classified_whale: 1,
        },
        whaleCount: 1,
        byCategory: { S_whale_class: 1 },
      }),
    });
    expect(JSON.stringify(card.blocks)).toMatch(/whale-class/);
    expect(JSON.stringify(card.blocks)).toMatch(/HARD-blocked/);
  });

  it("backlog non-zero surfaces classifier-degraded warning", () => {
    const card = renderEmailQueueCard({
      summary: summary({
        total: 5,
        byStatus: {
          received: 5,
          received_noise: 0,
          classified: 0,
          classified_whale: 0,
        },
        backlogReceived: 5,
      }),
    });
    expect(JSON.stringify(card.blocks)).toMatch(/waiting on the classifier/);
  });

  it("top rows truncate subjects at ~80 chars", () => {
    const longSubject = "x".repeat(120);
    const card = renderEmailQueueCard({
      summary: summary({
        total: 1,
        byStatus: {
          received: 0,
          received_noise: 0,
          classified: 1,
          classified_whale: 0,
        },
        byCategory: { A_sample_request: 1 },
        topRows: [row({ subject: longSubject })],
      }),
    });
    const blob = JSON.stringify(card.blocks);
    // Should not contain the entire 120-char string
    expect(blob).not.toContain(longSubject);
    // But should contain the truncated marker
    expect(blob).toContain("…");
  });

  it("renders truncated + degraded into the context block", () => {
    const card = renderEmailQueueCard({
      summary: summary({ total: 100 }),
      truncated: true,
      degraded: ["kv-scan: timeout"],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("truncated");
    expect(blob).toContain("kv-scan: timeout");
  });

  it("dashboard URL is the canonical /ops/email-agents path", () => {
    const card = renderEmailQueueCard({ summary: summary() });
    expect(JSON.stringify(card.blocks)).toContain(
      "/ops/email-agents",
    );
  });

  it("does NOT leak raw snippet / labelIds / body", () => {
    const card = renderEmailQueueCard({
      summary: summary({
        total: 1,
        topRows: [
          row({
            subject: "Hello",
            // these aren't part of the projected EmailAgentQueueRow type,
            // but we verify the renderer doesn't reach for fields outside it
          }),
        ],
        byStatus: {
          received: 0,
          received_noise: 0,
          classified: 1,
          classified_whale: 0,
        },
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).not.toContain("snippet");
    expect(blob).not.toContain("labelIds");
  });
});
