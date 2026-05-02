import { describe, expect, it } from "vitest";

import {
  parseSlackWorkpackCommand,
  renderWorkpackCreatedSlackCard,
  slackMessageUrl,
} from "../slack-workpack-router";
import type { WorkpackRecord } from "../workpacks";

describe("parseSlackWorkpackCommand", () => {
  it("parses ask codex into a safe prompt-prep workpack", () => {
    const parsed = parseSlackWorkpackCommand({
      text: "ask codex build the HubSpot stale queue",
      channel: "C_SALES",
      ts: "1777300000.111111",
      user: "U_BEN",
    });
    expect(parsed?.command).toBe("ask_codex");
    expect(parsed?.workpack.intent).toBe("prepare_codex_prompt");
    expect(parsed?.workpack.department).toBe("ops");
    expect(parsed?.workpack.sourceUrl).toBe(
      "https://usagummies.slack.com/archives/C_SALES/p1777300000111111",
    );
    expect(parsed?.workpack.allowedActions).toContain("prepare_prompt");
  });

  it("parses threaded draft reply commands against the parent thread", () => {
    const parsed = parseSlackWorkpackCommand({
      text: "draft reply: tell them we can send NCS tomorrow",
      channel: "C_SALES",
      ts: "1777300000.222222",
      threadTs: "1777300000.111111",
      user: "U_BEN",
    });
    expect(parsed?.command).toBe("draft_reply");
    expect(parsed?.workpack.intent).toBe("draft_reply");
    expect(parsed?.workpack.department).toBe("email");
    expect(parsed?.workpack.sourceUrl).toBe(
      slackMessageUrl("C_SALES", "1777300000.111111"),
    );
  });

  it("returns null for normal Slack chatter", () => {
    expect(
      parseSlackWorkpackCommand({ text: "thanks, looks good", channel: "C" }),
    ).toBeNull();
  });
});

describe("renderWorkpackCreatedSlackCard", () => {
  it("renders a Block Kit card with safety copy and dashboard links", () => {
    const record: WorkpackRecord = {
      id: "wp_1",
      status: "queued",
      intent: "prepare_codex_prompt",
      department: "ops",
      title: "Codex implementation prompt",
      sourceText: "Build a safe prompt",
      sourceUrl: "https://usagummies.slack.com/archives/C/p1",
      requestedBy: "U_BEN",
      allowedActions: ["prepare_prompt"],
      prohibitedActions: ["send_email", "write_qbo"],
      riskClass: "read_only",
      createdAt: "2026-05-02T12:00:00.000Z",
      updatedAt: "2026-05-02T12:00:00.000Z",
    };
    const card = renderWorkpackCreatedSlackCard(record);
    expect(card.text).toContain("Workpack queued");
    expect(JSON.stringify(card.blocks)).toContain("no email/send/CRM/checkout/QBO action");
    expect(JSON.stringify(card.blocks)).toContain("Open workpacks");
  });
});
