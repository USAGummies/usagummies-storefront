/**
 * Classifier tests — locks the decision/correction/transcript/followup/
 * report priority order from operating-memory.md §"What Slack must
 * capture".
 *
 * Critical contract: a CORRECTION signal in the body always wins, even
 * if the caller passes a `kindHint` of something else. This protects
 * the drift-detection loop — corrections must be filed under the
 * actionable bucket so the upstream bug surfaces.
 */

import { describe, expect, it } from "vitest";

import { classifyEntry } from "../classify";

describe("classifyEntry — corrections (highest priority)", () => {
  it("classifies 'that's wrong, actual figure is X'", () => {
    const c = classifyEntry("That's wrong — the actual figure is $1,755.");
    expect(c.kind).toBe("correction");
    expect(c.tags).toContain("correction:wrong");
    expect(c.tags).toContain("correction:figure");
  });

  it("classifies 'actually, ...'", () => {
    const c = classifyEntry("Actually, Mike is on Net 10 not Net 15.");
    expect(c.kind).toBe("correction");
    expect(c.tags).toContain("correction:actually");
  });

  it("classifies 'no, it's ...'", () => {
    const c = classifyEntry("No, it's $3.49/bag for B2, not $3.25.");
    expect(c.kind).toBe("correction");
  });

  it("classifies 'should be ...'", () => {
    const c = classifyEntry("The line should read '36-Bag Master Carton' not 'B2'.");
    expect(c.kind).toBe("correction");
    expect(c.tags).toContain("correction:should-be");
  });

  it("correction wins over decision when both signals present", () => {
    const c = classifyEntry(
      "Actually, that's wrong. We're locking pricing at B2 not B3. Decision logged.",
    );
    expect(c.kind).toBe("correction");
  });

  it("correction wins even when kindHint='decision'", () => {
    const c = classifyEntry(
      "Actually, the figure is $1,755 — please fix the report.",
      "decision",
    );
    expect(c.kind).toBe("correction");
  });
});

describe("classifyEntry — followup", () => {
  it("classifies 'todo: ...'", () => {
    const c = classifyEntry("TODO: test wholesale flow tonight");
    expect(c.kind).toBe("followup");
    expect(c.tags).toContain("followup:todo");
  });

  it("classifies 'I will follow up'", () => {
    const c = classifyEntry("I will follow up with Mike on Tuesday.");
    expect(c.kind).toBe("followup");
  });

  it("classifies 'next step is ...'", () => {
    const c = classifyEntry("Next step is to draft the QBO invoice.");
    expect(c.kind).toBe("followup");
  });
});

describe("classifyEntry — report", () => {
  it("classifies daily brief tells", () => {
    const c = classifyEntry("Daily brief — 2026-04-28: ...");
    expect(c.kind).toBe("report");
    expect(c.tags).toContain("report:daily-brief");
  });

  it("classifies weekly KPI tells", () => {
    const c = classifyEntry("Weekly KPI rollup for week of 4/21: revenue +12%.");
    expect(c.kind).toBe("report");
  });
});

describe("classifyEntry — transcript", () => {
  it("classifies 'call recap' tell", () => {
    const c = classifyEntry("Call recap with Powers — order count confirmed at 50K.");
    expect(c.kind).toBe("transcript");
  });

  it("classifies meeting notes tell", () => {
    const c = classifyEntry("Meeting notes — Ben + Rene 4/27 strategy session.");
    expect(c.kind).toBe("transcript");
  });
});

describe("classifyEntry — decision", () => {
  it("classifies 'we're locking ...'", () => {
    const c = classifyEntry("We're locking pricing at B1-B5 today.");
    expect(c.kind).toBe("decision");
    expect(c.tags).toContain("decision:locking");
  });

  it("classifies 'we'll go with ...'", () => {
    const c = classifyEntry("We'll go with Net 15 default for AP-path customers.");
    expect(c.kind).toBe("decision");
  });
});

describe("classifyEntry — fallback + edge cases", () => {
  it("falls back to transcript on empty body", () => {
    expect(classifyEntry("").kind).toBe("transcript");
  });

  it("falls back to transcript with no signals", () => {
    const c = classifyEntry("Random sentence about gummies and the weather.");
    expect(c.kind).toBe("transcript");
    expect(c.tags).toEqual([]);
  });

  it("honors kindHint when no correction signal present", () => {
    const c = classifyEntry("Random sentence.", "report");
    expect(c.kind).toBe("report");
  });

  it("classifies long multi-paragraph body as transcript", () => {
    const longBody = ("Paragraph one with substantive content about the call. " +
      "More words to flesh it out. ").repeat(20) +
      "\n\n" +
      "Paragraph two summarizing the action items.";
    const c = classifyEntry(longBody);
    expect(c.kind).toBe("transcript");
  });
});
