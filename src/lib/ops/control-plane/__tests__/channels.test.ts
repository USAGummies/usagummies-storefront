import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getChannel, listChannels, slackChannelRef } from "../channels";
import type { ChannelId } from "../types";

const EXPECTED_ACTIVE_CHANNEL_IDS: Record<string, string> = {
  "ops-daily": "C0ATWJDKLTU",
  "ops-approvals": "C0ATWJDHS74",
  "ops-audit": "C0AUQSA66TS",
  "ops-alerts": "C0ATUGGUZL6",
  sales: "C0AQQRXUYF7",
  finance: "C0ATF50QQ1M",
  operations: "C0AR75M63Q9",
  shipping: "C0AS4635HFG",
  research: "C08HWA9SRP1",
  "receipts-capture": "C0APYNE9E73",
  marketing: "C08J9EER9L5",
};

const RETIRED_CHANNEL_IDS = new Set([
  "C0ALS6W7VB4", // #abra-control
  "C0AKG9FSC2J", // #financials
  "C0AS7UHNGPL", // #wholesale-leads
  "C0ARSF61U5D", // #email-inbox
]);

describe("control-plane channel registry", () => {
  it("pins every active Slack channel to its live channel id", () => {
    for (const [id, slackChannelId] of Object.entries(EXPECTED_ACTIVE_CHANNEL_IDS)) {
      expect(getChannel(id as ChannelId)?.slackChannelId).toBe(slackChannelId);
    }
  });

  it("does not route active channels to retired Slack channel ids", () => {
    for (const channel of listChannels("active")) {
      expect(channel.slackChannelId).toBeTruthy();
      expect(RETIRED_CHANNEL_IDS.has(channel.slackChannelId ?? "")).toBe(false);
    }
  });

  it("keeps contracts/channels.json mirrored to the runtime ids", () => {
    const raw = readFileSync(join(process.cwd(), "contracts/channels.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      active: Array<{ id: string; slack_channel_id?: string }>;
    };
    const byId = new Map(parsed.active.map((channel) => [channel.id, channel]));
    for (const [id, slackChannelId] of Object.entries(EXPECTED_ACTIVE_CHANNEL_IDS)) {
      expect(byId.get(id)?.slack_channel_id).toBe(slackChannelId);
    }
  });

  it("slackChannelRef prefers live channel ids over names", () => {
    expect(slackChannelRef("ops-approvals")).toBe("C0ATWJDHS74");
    expect(slackChannelRef("finance")).toBe("C0ATF50QQ1M");
  });
});
