import { describe, expect, it, vi } from "vitest";
import { buildReadOnlyChatRouteRequest } from "@/app/api/ops/slack/events/route";
import { buildProactiveAlertSignature, shouldSuppressSignalPost } from "@/lib/ops/proactive-alerts";

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
});
