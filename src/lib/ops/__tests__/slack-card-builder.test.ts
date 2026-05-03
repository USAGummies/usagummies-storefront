/**
 * Slack card builder coverage — Build 9 doctrine.
 *
 * Pins:
 *   - postureLabel + postureIcon for green / yellow / red / unknown.
 *   - headerBlock renders title + posture chip + emoji.
 *   - statsBlock renders fields as 2-column mrkdwn.
 *   - listSectionBlock prefixes rows with "• ".
 *   - contextBlock includes generation time + read-only note + degraded.
 *   - actionsBlock renders link buttons (no destructive verbs).
 *   - buildPostureCard produces the canonical block sequence.
 *   - truncate respects custom max + appends "…".
 *   - At most 4 list sections rendered (cap).
 */
import { describe, expect, it } from "vitest";

import {
  actionsBlock,
  briefBlock,
  buildPostureCard,
  contextBlock,
  dividerBlock,
  headerBlock,
  listSectionBlock,
  postureIcon,
  postureLabel,
  statsBlock,
  truncate,
} from "../slack-card-builder";

describe("postureLabel + postureIcon", () => {
  it("returns the right chip per posture", () => {
    expect(postureLabel("green")).toMatch(/🟢/);
    expect(postureLabel("yellow")).toMatch(/🟡/);
    expect(postureLabel("red")).toMatch(/🔴/);
    expect(postureLabel("unknown")).toMatch(/⚪️/);
    expect(postureIcon("red")).toBe("🔴");
  });
});

describe("headerBlock", () => {
  it("renders title + posture + emoji", () => {
    const block = headerBlock({
      title: "Email queue",
      emoji: "✉️",
      posture: "yellow",
    }) as { type: string; text: { text: string; emoji: boolean } };
    expect(block.type).toBe("header");
    expect(block.text.text).toMatch(/✉️/);
    expect(block.text.text).toMatch(/Email queue/);
    expect(block.text.text).toMatch(/🟡 work waiting/);
    expect(block.text.emoji).toBe(true);
  });

  it("omits posture chip when posture is missing", () => {
    const block = headerBlock({
      title: "Static",
    }) as { text: { text: string } };
    expect(block.text.text).toBe("Static");
  });
});

describe("statsBlock", () => {
  it("renders fields as 2-column mrkdwn pairs", () => {
    const block = statsBlock([
      { label: "Total", value: 5 },
      { label: "Pending", value: "3" },
    ]) as { type: string; fields: Array<{ type: string; text: string }> };
    expect(block.type).toBe("section");
    expect(block.fields).toHaveLength(2);
    expect(block.fields[0].text).toBe("*Total*\n5");
    expect(block.fields[1].text).toBe("*Pending*\n3");
  });
});

describe("listSectionBlock", () => {
  it("prefixes each row with '• ' under a bold title", () => {
    const block = listSectionBlock({
      title: "Top rows",
      rows: ["row a", "row b"],
    }) as { text: { text: string } };
    expect(block.text.text).toContain("*Top rows*");
    expect(block.text.text).toContain("• row a");
    expect(block.text.text).toContain("• row b");
  });
});

describe("contextBlock", () => {
  it("includes generation time + read-only note", () => {
    const block = contextBlock({
      generatedAt: "2026-05-02T18:30:00.000Z",
      readOnlyNote: "no QBO write fires from this card",
    }) as { elements: Array<{ text: string }> };
    expect(block.elements[0].text).toMatch(/Generated 18:30Z/);
    expect(block.elements[0].text).toMatch(/no QBO write fires from this card/);
  });

  it("appends degraded list when provided", () => {
    const block = contextBlock({
      generatedAt: "2026-05-02T18:30:00.000Z",
      readOnlyNote: "x",
      degraded: ["a", "b"],
    }) as { elements: Array<{ text: string }> };
    expect(block.elements).toHaveLength(2);
    expect(block.elements[1].text).toMatch(/Degraded: a · b/);
  });
});

describe("actionsBlock", () => {
  it("renders link buttons", () => {
    const block = actionsBlock([
      {
        text: "Open dashboard",
        url: "https://example.com/x",
        actionId: "open_dashboard",
      },
    ]) as {
      elements: Array<{ type: string; url: string; action_id: string; text: { text: string } }>;
    };
    expect(block.elements[0].type).toBe("button");
    expect(block.elements[0].url).toBe("https://example.com/x");
    expect(block.elements[0].action_id).toBe("open_dashboard");
    expect(block.elements[0].text.text).toBe("Open dashboard");
  });
});

describe("dividerBlock", () => {
  it("returns a divider", () => {
    expect(dividerBlock()).toEqual({ type: "divider" });
  });
});

describe("truncate", () => {
  it("returns the string unchanged when below max", () => {
    expect(truncate("short", 80)).toBe("short");
  });
  it("truncates with ellipsis when above max", () => {
    expect(truncate("x".repeat(120), 80)).toMatch(/x{79}…/);
  });
  it("default max is 80", () => {
    expect(truncate("x".repeat(85)).length).toBe(80);
  });
});

describe("briefBlock", () => {
  it("renders mrkdwn section text", () => {
    const block = briefBlock("Brief copy.") as { text: { text: string } };
    expect(block.text.text).toBe("Brief copy.");
  });
});

describe("buildPostureCard", () => {
  it("produces canonical block sequence: header → stats → brief → context → actions", () => {
    const card = buildPostureCard({
      title: "Test",
      emoji: "🧪",
      topLine: "Test top line",
      posture: "green",
      stats: [{ label: "X", value: 1 }],
      brief: "Looks fine.",
      generatedAt: "2026-05-02T12:00:00.000Z",
      readOnlyNote: "read-only test",
      actions: [
        { text: "Go", url: "https://x", actionId: "go" },
      ],
    });
    expect(card.text).toBe("Test top line");
    const types = (card.blocks as Array<{ type: string }>).map((b) => b.type);
    expect(types).toEqual(["header", "section", "section", "context", "actions"]);
  });

  it("inserts list sections (with dividers) when provided", () => {
    const card = buildPostureCard({
      title: "Test",
      emoji: "🧪",
      topLine: "x",
      stats: [],
      brief: "x",
      sections: [
        { title: "S1", rows: ["a"] },
        { title: "S2", rows: ["b"] },
      ],
      generatedAt: "2026-05-02T12:00:00.000Z",
      readOnlyNote: "x",
      actions: [],
    });
    const types = (card.blocks as Array<{ type: string }>).map((b) => b.type);
    // header / stats / brief / divider / section / divider / section / context
    expect(types).toEqual([
      "header",
      "section",
      "section",
      "divider",
      "section",
      "divider",
      "section",
      "context",
    ]);
  });

  it("caps list sections at 4", () => {
    const card = buildPostureCard({
      title: "x",
      emoji: "x",
      topLine: "x",
      stats: [],
      brief: "x",
      sections: [
        { title: "1", rows: ["a"] },
        { title: "2", rows: ["b"] },
        { title: "3", rows: ["c"] },
        { title: "4", rows: ["d"] },
        { title: "5", rows: ["e"] },
        { title: "6", rows: ["f"] },
      ],
      generatedAt: "2026-05-02T12:00:00.000Z",
      readOnlyNote: "x",
      actions: [],
    });
    // 4 dividers + 4 sections = 8 list-related blocks.
    const types = (card.blocks as Array<{ type: string }>).map((b) => b.type);
    const dividers = types.filter((t) => t === "divider");
    expect(dividers).toHaveLength(4);
  });

  it("omits actions block when no links provided", () => {
    const card = buildPostureCard({
      title: "x",
      emoji: "x",
      topLine: "x",
      stats: [],
      brief: "x",
      generatedAt: "2026-05-02T12:00:00.000Z",
      readOnlyNote: "x",
      actions: [],
    });
    const types = (card.blocks as Array<{ type: string }>).map((b) => b.type);
    expect(types).not.toContain("actions");
  });
});
