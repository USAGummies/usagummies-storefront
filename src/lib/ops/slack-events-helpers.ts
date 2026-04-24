/**
 * Slack events helpers — pure utility functions extracted from the
 * route file at src/app/api/ops/slack/events/route.ts.
 *
 * Why this file exists: Next.js App Router enforces that route files
 * export ONLY handler functions (GET/POST/PATCH/etc.) plus a short
 * allow-list of config symbols (runtime, dynamic, etc.). Any other
 * export fails the build with:
 *   "<name>" is not a valid Route export field.
 * Tests + helpers that need cross-file imports live here instead.
 */
import type { Buffer } from "node:buffer";

export async function buildReadOnlyChatRouteRequest(input: {
  message: string;
  history: Array<{ role: string; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  uploadedFiles?: Array<{ name: string; mimeType: string; buffer: Buffer }>;
}): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const files = input.uploadedFiles ?? [];
  if (files.length > 0) {
    const form = new FormData();
    form.set("message", input.message);
    form.set("actorLabel", input.actorLabel);
    form.set("channel", input.channel);
    if (input.slackChannelId) form.set("slackChannelId", input.slackChannelId);
    if (input.slackThreadTs) form.set("slackThreadTs", input.slackThreadTs);
    form.set("history", JSON.stringify(input.history));
    for (const file of files) {
      // Copy Buffer contents into a fresh ArrayBuffer-backed Uint8Array.
      // Blob's BlobPart contract requires ArrayBuffer (not the
      // ArrayBufferLike union that Node's Buffer.buffer exposes, which
      // could be SharedArrayBuffer).
      const owned = Uint8Array.from(file.buffer);
      form.append(
        "file",
        new Blob([owned], { type: file.mimeType }),
        file.name,
      );
    }
    return { body: form, headers: {} };
  }

  return {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  };
}

export function isRedundantMentionMirrorEvent(event: {
  type?: string;
  text?: string;
}): boolean {
  return event.type === "message" && /<@[^>]+>/.test(event.text ?? "");
}
