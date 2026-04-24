// Sibling-file helpers for src/app/api/ops/slack/events/route.ts
//
// Next.js 15's Route typing only allows specific exports from route files
// (GET, POST, etc., plus runtime / dynamic / revalidate). Custom helpers like
// buildReadOnlyChatRouteRequest and isRedundantMentionMirrorEvent must live
// in a sibling file and be re-imported. Moved out of route.ts to fix a build
// break introduced in commit e731402.

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
      // Node Buffer isn't a valid BlobPart under TS strict settings; wrap
      // in Uint8Array so it satisfies the BufferSource constraint.
      form.append(
        "file",
        new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
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
