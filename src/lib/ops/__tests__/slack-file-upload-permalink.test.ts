/**
 * Phase 27 — `permalinkToMessageTs` extraction helper. Lets the
 * caller thread follow-up files (e.g. packing slip under label)
 * since `files.completeUploadExternal` doesn't return the parent
 * message ts directly.
 *
 * Hard rules:
 *   - Slack permalink format: `…/archives/<channel>/p<digits>` where
 *     <digits> is the `message_ts` with the decimal removed (last 6
 *     digits are microseconds).
 *   - Returns `undefined` on any unparseable input — defensive,
 *     NEVER fabricates a ts.
 */
import { describe, expect, it } from "vitest";

import { permalinkToMessageTs } from "@/lib/ops/slack-file-upload";

describe("permalinkToMessageTs", () => {
  it("parses a typical permalink", () => {
    expect(
      permalinkToMessageTs(
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000123456",
      ),
    ).toBe("1745000000.123456");
  });

  it("parses a permalink with a thread query string", () => {
    expect(
      permalinkToMessageTs(
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000123456?thread_ts=1745000000.000001",
      ),
    ).toBe("1745000000.123456");
  });

  it("parses a permalink with a fragment", () => {
    expect(
      permalinkToMessageTs(
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000123456#anchor",
      ),
    ).toBe("1745000000.123456");
  });

  it("undefined permalink → undefined", () => {
    expect(permalinkToMessageTs(undefined)).toBeUndefined();
  });

  it("empty permalink → undefined", () => {
    expect(permalinkToMessageTs("")).toBeUndefined();
  });

  it("non-permalink string → undefined (defensive)", () => {
    expect(permalinkToMessageTs("not a url")).toBeUndefined();
    expect(permalinkToMessageTs("https://slack.com/")).toBeUndefined();
  });

  it("permalink without /p<digits> → undefined", () => {
    expect(
      permalinkToMessageTs("https://usagummies.slack.com/archives/C0AS4635HFG"),
    ).toBeUndefined();
  });

  it("permalink with too-short digit run → undefined", () => {
    // 6 digits is the microseconds suffix only; needs at least 7
    // (1 second + 6 micros).
    expect(
      permalinkToMessageTs(
        "https://usagummies.slack.com/archives/C0AS4635HFG/p123456",
      ),
    ).toBeUndefined();
  });

  it("NEVER fabricates a ts on garbage input", () => {
    const candidates: Array<string | undefined> = [
      undefined,
      "",
      "garbage",
      "https://slack.com/foo/bar",
      "/p123",
    ];
    for (const c of candidates) {
      const out = permalinkToMessageTs(c);
      expect(out).toBeUndefined();
      // Specifically NOT the literal strings "0", "NaN", or empty.
      expect(out).not.toBe("0");
      expect(out).not.toBe("NaN");
      expect(out).not.toBe("");
    }
  });
});
