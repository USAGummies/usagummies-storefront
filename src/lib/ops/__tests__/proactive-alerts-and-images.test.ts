import { describe, expect, it, vi } from "vitest";
import {
  buildReadOnlyChatRouteRequest,
  isRedundantMentionMirrorEvent,
} from "@/app/api/ops/slack/events/helpers";
import {
  buildProactiveAlertSignature,
  shouldSuppressSameDayAlertType,
  shouldSuppressSignalPost,
} from "@/lib/ops/proactive-alerts";
import {
  buildSlackDedupRowId,
  buildSlackEventDedupKey,
} from "@/lib/ops/slack-dedup";

vi.mock("server-only", () => ({}));

describe("Slack image upload handoff", () => {
  it("uses multipart form-data when Slack uploads include an image", async () => {
    const request = await buildReadOnlyChatRouteRequest({
      message: "Please analyze the attached image from Slack and answer the user directly.",
      history: [],
      actorLabel: "Rene",
      channel: "slack",
      slackChannelId: "C123",
      slackThreadTs: "123.456",
      uploadedFiles: [
        {
          name: "invoice.png",
          mimeType: "image/png",
          buffer: Buffer.from("hello"),
        },
      ],
    });

    expect(request.body).toBeInstanceOf(FormData);
    expect("Content-Type" in (request.headers as Record<string, string>)).toBe(false);
    const form = request.body as FormData;
    expect(form.get("message")).toBe("Please analyze the attached image from Slack and answer the user directly.");
    expect(form.get("file")).toBeTruthy();
  });

  it("uses the same event dedup key for app_mention and message variants of one Slack post", () => {
    const base = {
      channel: "C123",
      user: "U123",
      messageTs: "1711670000.123456",
      rootThreadTs: "1711670000.123456",
      text: "<@U0AKMSTL0GL> what does this image show?",
    };

    const mentionKey = buildSlackEventDedupKey({
      ...base,
      eventId: null,
    });
    const messageKey = buildSlackEventDedupKey({
      ...base,
      eventId: null,
    });

    expect(mentionKey).toBe(messageKey);
  });

  it("drops the redundant message mirror for a direct @Abra mention", () => {
    expect(
      isRedundantMentionMirrorEvent({
        type: "message",
        text: "<@U0AKMSTL0GL> what is our BofA balance?",
      }),
    ).toBe(true);

    expect(
      isRedundantMentionMirrorEvent({
        type: "app_mention",
        text: "<@U0AKMSTL0GL> what is our BofA balance?",
      }),
    ).toBe(false);
  });

  it("builds a stable UUID row id for atomic Slack dedup claims", () => {
    const dedupKey = buildSlackEventDedupKey({
      eventId: null,
      channel: "C123",
      user: "U123",
      messageTs: "1711670000.123456",
      rootThreadTs: "1711670000.123456",
      text: "<@U0AKMSTL0GL> what is our BofA balance?",
    });

    const eventId = buildSlackDedupRowId(dedupKey, "event");
    const sameEventId = buildSlackDedupRowId(dedupKey, "event");
    const messageId = buildSlackDedupRowId(dedupKey, "message");

    expect(eventId).toBe(sameEventId);
    expect(eventId).not.toBe(messageId);
    expect(eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("proactive alert signal dedup", () => {
  it("suppresses identical revenue alerts on the same day", () => {
    const signature = buildProactiveAlertSignature({
      type: "revenue_drop",
      title: "Revenue Drop Detected",
      message: "Today is down versus average.",
      data: { todayRevenue: 5.99, avgRevenue: 42.92, dropPct: 86 },
    });

    expect(
      shouldSuppressSignalPost(
        { ts: Date.UTC(2026, 2, 28, 0, 40), day: "2026-03-28", signature },
        "2026-03-28",
        signature,
        Date.UTC(2026, 2, 28, 6, 40),
      ),
    ).toBe(true);
  });

  it("allows reposting when the signal payload changes or the day rolls over", () => {
    const oldSignature = buildProactiveAlertSignature({
      type: "revenue_drop",
      title: "Revenue Drop Detected",
      message: "Today is down versus average.",
      data: { todayRevenue: 5.99, avgRevenue: 42.92, dropPct: 86 },
    });
    const newSignature = buildProactiveAlertSignature({
      type: "revenue_drop",
      title: "Revenue Drop Detected",
      message: "Today is down versus average.",
      data: { todayRevenue: 1.99, avgRevenue: 42.92, dropPct: 95 },
    });

    expect(
      shouldSuppressSignalPost(
        { ts: Date.UTC(2026, 2, 28, 0, 40), day: "2026-03-28", signature: oldSignature },
        "2026-03-28",
        newSignature,
        Date.UTC(2026, 2, 28, 6, 40),
      ),
    ).toBe(false);

    expect(
      shouldSuppressSignalPost(
        { ts: Date.UTC(2026, 2, 28, 23, 50), day: "2026-03-28", signature: oldSignature },
        "2026-03-29",
        oldSignature,
        Date.UTC(2026, 2, 29, 0, 10),
      ),
    ).toBe(false);
  });

  it("suppresses any same-day revenue alert once the day-level dedup key is reserved", () => {
    expect(
      shouldSuppressSameDayAlertType(
        "revenue_drop",
        {
          ts: Date.UTC(2026, 2, 28, 13, 10),
          day: "2026-03-28",
          signature: "one",
        },
        "2026-03-28",
        Date.UTC(2026, 2, 28, 19, 40),
      ),
    ).toBe(true);
  });
});
