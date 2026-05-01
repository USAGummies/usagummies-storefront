import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("B2B Revenue Watcher cron", () => {
  it("runs before the morning brief and does not request Slack posting", () => {
    const parsed = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons: Array<{ path: string; schedule: string }> };

    const cron = parsed.crons.find(
      (c) => c.path === "/api/ops/agents/b2b-revenue-watcher/run",
    );
    expect(cron).toBeDefined();
    expect(cron?.schedule).toBe("45 14 * * 1-5");
    expect(cron?.path).not.toContain("post=true");

    const brief = parsed.crons.find(
      (c) => c.path === "/api/ops/daily-brief?kind=morning&post=true",
    );
    expect(brief?.schedule).toBe("0 15 * * 1-5");
  });
});
