import { describe, expect, it } from "vitest";

import { gmailAfterFragment } from "../cursor";

describe("email-intelligence/cursor", () => {
  it("formats a Unix timestamp as Gmail's after:YYYY/MM/DD with one-day buffer", () => {
    // 2026-04-24 18:00 UTC
    const ts = Date.UTC(2026, 3, 24, 18, 0, 0) / 1000;
    const frag = gmailAfterFragment(ts);
    // Buffer rolls back one full day → 2026-04-23.
    expect(frag).toBe("after:2026/04/23");
  });

  it("handles month boundary correctly with one-day buffer", () => {
    // 2026-05-01 12:00 UTC
    const ts = Date.UTC(2026, 4, 1, 12, 0, 0) / 1000;
    const frag = gmailAfterFragment(ts);
    expect(frag).toBe("after:2026/04/30");
  });
});
