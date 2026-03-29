import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  getSlackDisplayName,
  getRecentChannelContext,
  getThreadHistory,
  postSlackMessage,
} from "@/lib/ops/abra-slack-responder";
import { extractPdfTextFromBuffer } from "@/lib/ops/file-text-extraction";
import { executeRoutedAction, renderRoutedActionResponse } from "@/lib/ops/operator/action-executor";
import { routeMessage } from "@/lib/ops/operator/deterministic-router";
import { shouldClaimSlackMessageReply, shouldProcessSlackEvent } from "@/lib/ops/slack-dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // after() needs time for chat API call (up to 55s)

type SlackFile = {
  id: string;
  name: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type SlackEventBody = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
    files?: SlackFile[];
  };
};

function verifySlackSignature(req: Request, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !signingSecret) return false;
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const EXTRACTABLE_TYPES = new Set([
  "xlsx", "xls", "csv", "tsv", "pdf", "doc", "docx", "txt", "json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/json",
]);

function isExtractableFile(file: SlackFile): boolean {
  if (file.size && file.size > 10 * 1024 * 1024) return false; // 10MB limit
  const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
  return EXTRACTABLE_TYPES.has(ext) || EXTRACTABLE_TYPES.has(file.mimetype || "") || EXTRACTABLE_TYPES.has(file.filetype || "");
}

function isImageFile(file: SlackFile): boolean {
  return Boolean((file.mimetype || "").startsWith("image/"));
}

async function downloadSlackFile(url: string): Promise<Buffer | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}

async function downloadSlackImage(file: SlackFile): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const url = file.url_private_download || file.url_private;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || file.mimetype || "image/png";
    if (!contentType.startsWith("image/")) return null;
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return {
      name: file.name || "slack-image",
      mimeType: contentType,
      buffer,
    };
  } catch {
    return null;
  }
}

async function extractSlackFiles(files: SlackFile[]): Promise<string> {
  const results: string[] = [];

  for (const file of files.slice(0, 5)) { // Max 5 files
    if (isImageFile(file)) {
      results.push(`📎 ${file.name || "image"} — image attached`);
      continue;
    }
    if (!isExtractableFile(file)) {
      results.push(`📎 ${file.name} (${file.filetype || "unknown"}) — skipped (unsupported type or too large)`);
      continue;
    }

    const url = file.url_private_download || file.url_private;
    if (!url) {
      results.push(`📎 ${file.name} — no download URL available`);
      continue;
    }

    const data = await downloadSlackFile(url);
    if (!data) {
      results.push(`📎 ${file.name} — download failed`);
      continue;
    }

    const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
    const mime = file.mimetype || "";

    try {
      // CSV / TSV / TXT / JSON — plain text
      if (ext === "csv" || ext === "tsv" || ext === "txt" || ext === "json" ||
          mime.startsWith("text/") || mime === "application/json") {
        const text = data.toString("utf-8").slice(0, 50000); // 50KB text limit
        results.push(`📎 **${file.name}** (${ext}):\n\`\`\`\n${text}\n\`\`\``);
        continue;
      }

      // Excel spreadsheets
      if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(data, { type: "buffer" });
        const sheets: string[] = [];
        for (const sheetName of workbook.SheetNames.slice(0, 10)) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
          if (csv.trim()) {
            sheets.push(`Sheet "${sheetName}":\n${csv.slice(0, 15000)}`);
          }
        }
        results.push(`📎 **${file.name}** (Excel, ${workbook.SheetNames.length} sheet${workbook.SheetNames.length !== 1 ? "s" : ""}):\n${sheets.join("\n\n")}`);
        continue;
      }

      // PDF
      if (ext === "pdf" || mime === "application/pdf") {
        try {
          const extracted = await extractPdfTextFromBuffer(data, {
            maxPages: 30,
            maxChars: 50_000,
            scannedPlaceholder: "[Scanned PDF — no extractable text. Needs OCR or CSV export.]",
          });
          results.push(`📎 **${file.name}** (PDF):\n${extracted.text}`);
        } catch (pdfErr) {
          results.push(`📎 ${file.name} — PDF extraction failed: ${pdfErr instanceof Error ? pdfErr.message : "unknown error"}`);
        }
        continue;
      }

      results.push(`📎 ${file.name} — unsupported format for extraction`);
    } catch (err) {
      results.push(`📎 ${file.name} — extraction error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return results.join("\n\n");
}

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://www.usagummies.com"
  );
}

function stripAbraMention(text: string): string {
  return text.replace(/<@U0AKMSTL0GL>\s*/g, "").trim();
}

function normalizeConstraintText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildThreadConstraintBlock(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  fileContext: string,
): string {
  const userTexts = [...history.filter((item) => item.role === "user").map((item) => item.content), message]
    .map(normalizeConstraintText)
    .filter(Boolean);
  const joined = userTexts.join("\n");
  const constraints: string[] = [];

  if (/\b(?:do not|don't|dont|not)\b[\s\S]{0,50}\b(qbo|quickbooks)\b/i.test(joined) || /\bnot from qbo\b/i.test(joined)) {
    constraints.push("Do not use QBO or QuickBooks as the source.");
  }
  if (/\bexcel\b/i.test(joined) || /\bcsv\b/i.test(joined)) {
    constraints.push("Prefer Excel or CSV output if the user is asking for an export.");
  }
  if (/\bpdf\b/i.test(joined) || /PDF extraction failed/i.test(fileContext)) {
    constraints.push("Do not promise OCR. If the PDF text was extracted, use it. If the file is scanned/image-only, say that plainly and suggest OCR or CSV as the fallback.");
  }
  if (history.some((item) => item.role === "assistant")) {
    constraints.push("You are already participating in this Slack thread. Stay engaged even if Ben or other humans are mentioned. Do not go silent.");
  }

  if (constraints.length === 0) return "";
  return `[THREAD CONSTRAINTS]\n${constraints.map((item) => `- ${item}`).join("\n")}\n\n`;
}

type ChatRouteUpload = { name: string; mimeType: string; buffer: Buffer };

export async function buildReadOnlyChatRouteRequest(payload: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId: string;
  slackThreadTs: string;
  uploadedFiles?: ChatRouteUpload[];
}): Promise<{ headers: HeadersInit; body: string | FormData }> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const authHeaders: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {};
  if (payload.uploadedFiles && payload.uploadedFiles.length > 0) {
    const form = new FormData();
    form.set("message", payload.message);
    form.set("history", JSON.stringify(payload.history));
    form.set("actor_label", payload.actorLabel);
    form.set("channel", "slack");
    form.set("slack_channel_id", payload.slackChannelId);
    form.set("slack_thread_ts", payload.slackThreadTs);
    const firstFile = payload.uploadedFiles[0];
    const blob = new Blob([new Uint8Array(firstFile.buffer)], { type: firstFile.mimeType || "application/octet-stream" });
    form.set("file", blob, firstFile.name);
    return { headers: authHeaders, body: form };
  }

  return {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      message: payload.message,
      history: payload.history,
      actor_label: payload.actorLabel,
      channel: "slack",
      slack_channel_id: payload.slackChannelId,
      slack_thread_ts: payload.slackThreadTs,
    }),
  };
}

async function callReadOnlyChatRoute(payload: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId: string;
  slackThreadTs: string;
  uploadedFiles?: ChatRouteUpload[];
}): Promise<{ reply: string; blocks?: Array<Record<string, unknown>> } | null> {
  const request = await buildReadOnlyChatRouteRequest(payload);
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/abra/chat`, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data.reply !== "string" || !data.reply.trim()) return null;
  const blocks = Array.isArray(data.blocks) ? (data.blocks as Array<Record<string, unknown>>) : undefined;
  return { reply: data.reply.trim(), blocks };
}

export async function POST(req: Request) {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json(
      { error: "Slack events not configured (missing SLACK_SIGNING_SECRET)" },
      { status: 501 },
    );
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: SlackEventBody = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as SlackEventBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge || "" });
  }

  const event = body.event;
  const supportedEvent =
    body.type === "event_callback" &&
    event &&
    (event.type === "message" || event.type === "app_mention");
  if (!supportedEvent) {
    return NextResponse.json({ ok: true });
  }

  const { text, user, channel, ts, thread_ts, bot_id, subtype, files } = event;
  if (bot_id || subtype === "bot_message") {
    return NextResponse.json({ ok: true });
  }
  // Accept messages with text OR files (file-only messages have empty text)
  const hasText = Boolean(text?.trim());
  const hasFiles = Array.isArray(files) && files.length > 0;
  if ((!hasText && !hasFiles) || !user || !channel || !ts) {
    return NextResponse.json({ ok: true });
  }

  // Capture idempotency values before entering after() — the request object
  // may not be readable inside the background callback.
  const isRetry = Boolean(req.headers.get("x-slack-retry-num"));

  // Return 200 IMMEDIATELY so Slack never times out and retries.
  // All processing — including the dedup check — happens inside after().
  after(async () => {
    // Slack retries carry x-slack-retry-num. Since we already returned 200 on
    // the original request, skip retries to prevent double-processing.
    if (isRetry) return;

    if (!(await shouldProcessSlackEvent({
      eventId: body.event_id || null,
      channel,
      user,
      messageTs: ts,
      rootThreadTs: thread_ts || ts,
      text: text || "",
    }))) {
      return;
    }

    try {
      const [displayName, history] = await Promise.all([
        getSlackDisplayName(user),
        thread_ts
          ? getThreadHistory(channel, thread_ts)
          : getRecentChannelContext(channel, ts),
      ]);

      // If files are attached, download and extract their content
      let fileContext = "";
      let uploadedFiles: Array<{ name: string; mimeType: string; buffer: Buffer }> = [];
      if (hasFiles) {
        const [extracted, images] = await Promise.all([
          extractSlackFiles(files!),
          Promise.all((files || []).filter(isImageFile).slice(0, 1).map((file) => downloadSlackImage(file))),
        ]);
        if (extracted) {
          fileContext = extracted;
        }
        uploadedFiles = images.filter((value): value is { name: string; mimeType: string; buffer: Buffer } => Boolean(value));
      }

      // Build the message text — include file context if present
      const explicitText = text?.trim() || "";
      const inferredPrompt =
        !explicitText && uploadedFiles.length > 0
          ? "Please analyze the attached image from Slack and answer the user directly."
          : "";
      const messageText = [
        explicitText || inferredPrompt,
        fileContext ? `\n\n[ATTACHED FILES]\n${fileContext}` : "",
      ].filter(Boolean).join("");

      const rootThreadTs = thread_ts || ts;
      if (!(await shouldClaimSlackMessageReply({
        channel,
        rootThreadTs,
        user,
        messageTs: ts,
      }))) {
        return;
      }

      const normalizedMessage = stripAbraMention(messageText || "(file attachment — see attached files above)");
      const routed = routeMessage(normalizedMessage, user, {
        history,
      });

      if (routed) {
        const executed = await executeRoutedAction(routed, {
          actor: displayName,
          slackChannelId: channel,
          slackThreadTs: rootThreadTs,
          slackUserId: user,
          history,
        });
        const rendered = renderRoutedActionResponse(executed);
        await postSlackMessage(channel, rendered.reply, {
          threadTs: rootThreadTs,
          blocks: rendered.blocks,
        });
        return;
      }

      const conversationMessage = `${buildThreadConstraintBlock(normalizedMessage, history, fileContext)}${normalizedMessage}`.trim();
      const chatResult = await callReadOnlyChatRoute({
        message: conversationMessage,
        history,
        actorLabel: displayName,
        channel: "slack",
        slackChannelId: channel,
        slackThreadTs: rootThreadTs,
        uploadedFiles,
      });

      if (chatResult?.reply) {
        await postSlackMessage(channel, chatResult.reply, {
          threadTs: rootThreadTs,
          blocks: chatResult.blocks,
        });
        return;
      }

      await postSlackMessage(
        channel,
        "I hit an error while processing that. Send the next instruction and I’ll continue.",
        { threadTs: rootThreadTs },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Slack events processing error";
      console.error("[ops/slack/events] async processing failed:", message);
      if (event.type === "app_mention" || channel === "C0AKG9FSC2J" || channel === "C0ALS6W7VB4" || channel === "C0A9S88E1FT") {
        await postSlackMessage(channel, "I hit an error while processing that. Send the next instruction and I’ll continue.", {
          threadTs: thread_ts || ts,
        }).catch(() => {});
      }
    }
  });

  return NextResponse.json({ ok: true });
}
