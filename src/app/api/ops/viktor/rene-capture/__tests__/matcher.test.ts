/**
 * W-7 matcher tests.
 *
 * These exercise the pure regex matcher — no Slack / Supabase / cron
 * machinery is touched. The regex is the load-bearing contract that
 * decides whether a Rene message becomes a durable decision log entry,
 * so it must be covered.
 */

import { describe, expect, it } from "vitest";

import { matchW7Message } from "../matcher";

describe("matchW7Message", () => {
  it("matches a standard R.NN response", () => {
    const res = matchW7Message("R.04: 0.95 / 0.70 / escalate");
    expect(res).toEqual([{ id: "R.04", answer: "0.95 / 0.70 / escalate" }]);
  });

  it("matches a J.NN joint response", () => {
    const res = matchW7Message("J.02: Net 30 A-tier, Net 15 B-tier, prepaid Default");
    expect(res).toEqual([
      { id: "J.02", answer: "Net 30 A-tier, Net 15 B-tier, prepaid Default" },
    ]);
  });

  it("matches a CF-NN contradiction resolution", () => {
    const res = matchW7Message("CF-01: direct to BofA, checked last payout");
    expect(res).toEqual([
      { id: "CF-01", answer: "direct to BofA, checked last payout" },
    ]);
  });

  it("matches a D.NNN internal decision register id", () => {
    const res = matchW7Message("D.215: 30 / 60 / 90");
    expect(res).toEqual([{ id: "D.215", answer: "30 / 60 / 90" }]);
  });

  it("matches APPROVED on a template id", () => {
    const res = matchW7Message("APPROVED: AIS-001 v2");
    expect(res).toEqual([{ id: "APPROVED", answer: "AIS-001 v2" }]);
  });

  it("matches REDLINE with a longer payload", () => {
    const res = matchW7Message("REDLINE: ARR-003: change +7 to +10 past-due");
    expect(res).toEqual([
      { id: "REDLINE", answer: "ARR-003: change +7 to +10 past-due" },
    ]);
  });

  it("tolerates bold markdown prefix", () => {
    const res = matchW7Message("*R.04*: 0.95 / 0.70 / escalate");
    expect(res).toEqual([{ id: "R.04", answer: "0.95 / 0.70 / escalate" }]);
  });

  it("tolerates blockquote prefix", () => {
    const res = matchW7Message("> R.04 — 0.95 / 0.70 / escalate");
    expect(res).toEqual([{ id: "R.04", answer: "0.95 / 0.70 / escalate" }]);
  });

  it("normalizes id to uppercase", () => {
    const res = matchW7Message("r.04: 0.95 / 0.70 / escalate");
    expect(res).toEqual([{ id: "R.04", answer: "0.95 / 0.70 / escalate" }]);
  });

  it("captures multiple decisions in a single multi-line message", () => {
    const text = [
      "R.04: 0.95 / 0.70 / escalate",
      "R.05: contra-revenue",
      "APPROVED: AIS-001 v2",
    ].join("\n");
    const res = matchW7Message(text);
    expect(res).toEqual([
      { id: "R.04", answer: "0.95 / 0.70 / escalate" },
      { id: "R.05", answer: "contra-revenue" },
      { id: "APPROVED", answer: "AIS-001 v2" },
    ]);
  });

  it("ignores lines without a matchable id", () => {
    const text = [
      "R.04: 0.95 / 0.70 / escalate",
      "let's talk about R.05 on a call later",
      "APPROVED: AIS-001 v2",
    ].join("\n");
    const res = matchW7Message(text);
    expect(res).toEqual([
      { id: "R.04", answer: "0.95 / 0.70 / escalate" },
      { id: "APPROVED", answer: "AIS-001 v2" },
    ]);
  });

  it("refuses empty payload", () => {
    expect(matchW7Message("R.04: ")).toEqual([]);
    expect(matchW7Message("R.04:")).toEqual([]);
  });

  it("returns empty for unrelated text", () => {
    expect(matchW7Message("hey ben, what's the status on the run")).toEqual([]);
    expect(matchW7Message("")).toEqual([]);
  });

  it("does not match a decision-id substring inside mid-message text", () => {
    // Only line-start matches — mentioning R.04 mid-sentence should not capture.
    expect(
      matchW7Message("I saw R.04 in the brief but haven't decided yet"),
    ).toEqual([]);
  });

  it("tolerates a hyphen separator instead of colon", () => {
    expect(matchW7Message("R.04 - 0.95 / 0.70 / escalate")).toEqual([
      { id: "R.04", answer: "0.95 / 0.70 / escalate" },
    ]);
  });
});
