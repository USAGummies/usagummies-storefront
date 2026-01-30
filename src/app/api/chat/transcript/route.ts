import { NextResponse } from "next/server";

export const runtime = "nodejs";

type IncomingMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type TranscriptPayload = {
  sessionId?: string;
  reason?: "session_end" | "human_request";
  email?: string;
  phone?: string;
  messages?: IncomingMessage[];
  pageUrl?: string;
  userAgent?: string;
  startedAt?: string;
  lastActiveAt?: string;
};

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatTranscript(messages: IncomingMessage[]) {
  if (!messages.length) return "No messages captured.";
  return messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content)
    .map((message) => {
      const label = message.role === "user" ? "Customer" : "Assistant";
      return `${label}: ${String(message.content)}`;
    })
    .join("\n");
}

export async function POST(req: Request) {
  const webhookUrl = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!webhookUrl) {
    return json({ ok: false, error: "Missing SLACK_SUPPORT_WEBHOOK_URL." }, 500);
  }

  let body: TranscriptPayload = {};
  try {
    body = (await req.json()) as TranscriptPayload;
  } catch {
    body = {};
  }

  const reason = body.reason === "human_request" ? "human_request" : "session_end";
  const header =
    reason === "human_request" ? "Support chat: human requested" : "Support chat: session ended";

  const lines = [
    header,
    body.email ? `Email: ${body.email}` : null,
    body.phone ? `Phone: ${body.phone}` : null,
    body.pageUrl ? `Page: ${body.pageUrl}` : null,
    body.startedAt ? `Started: ${body.startedAt}` : null,
    body.lastActiveAt ? `Last active: ${body.lastActiveAt}` : null,
    body.sessionId ? `Session: ${body.sessionId}` : null,
    body.userAgent ? `User agent: ${body.userAgent}` : null,
  ].filter(Boolean);

  const transcript = formatTranscript(Array.isArray(body.messages) ? body.messages : []);
  const text = `${lines.join("\n")}\n\n${transcript}`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "#website",
        text,
      }),
    });
    if (!res.ok) {
      return json({ ok: false, error: "Slack webhook failed." }, 502);
    }
  } catch {
    return json({ ok: false, error: "Slack webhook failed." }, 502);
  }

  return json({ ok: true });
}
