import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  getSlackDisplayName,
  getThreadHistory,
  postSlackMessage,
  processAbraMessage,
} from "@/lib/ops/abra-slack-responder";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const key = `abra:slack:event:${eventId}`;
  try {
    const existing = await kv.get(key);
    if (existing) return true;
    await kv.set(key, "1", { ex: 300 });
  } catch {
    // KV unavailable — fail open
  }
  return false;
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

async function extractSlackFiles(files: SlackFile[]): Promise<string> {
  const results: string[] = [];

  for (const file of files.slice(0, 5)) { // Max 5 files
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
          const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const doc = await (pdfjsLib as unknown as { getDocument: (arg: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }> }> }> } }).getDocument({ data: new Uint8Array(data) }).promise;
          const pages: string[] = [];
          for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items
              .map((item) => (item as { str?: string }).str || "")
              .join(" ");
            if (pageText.trim()) pages.push(pageText.trim());
          }
          const pdfText = pages.join("\n\n").slice(0, 50000);
          results.push(`📎 **${file.name}** (PDF, ${doc.numPages} pages):\n${pdfText}`);
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

  if (await isDuplicateEvent(body.event_id || "")) {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      const [displayName, history] = await Promise.all([
        getSlackDisplayName(user),
        thread_ts ? getThreadHistory(channel, thread_ts) : Promise.resolve([]),
      ]);

      // If files are attached, download and extract their content
      let fileContext = "";
      if (hasFiles) {
        const extracted = await extractSlackFiles(files!);
        if (extracted) {
          fileContext = extracted;
        }
      }

      // Build the message text — include file context if present
      const messageText = [
        text?.trim() || "",
        fileContext ? `\n\n[ATTACHED FILES]\n${fileContext}` : "",
      ].filter(Boolean).join("");

      const result = await processAbraMessage({
        text: messageText || "(file attachment — see attached files above)",
        user,
        displayName,
        channel,
        ts,
        ...(thread_ts ? { threadTs: thread_ts } : {}),
        ...(history.length > 0 ? { history } : {}),
        forceRespond: event.type === "app_mention",
      });
      if (!result.handled) return;
      const rootThreadTs = thread_ts || ts;
      await postSlackMessage(channel, result.reply, {
        threadTs: rootThreadTs,
        sources: result.sources,
        answerLogId: result.answerLogId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Slack events processing error";
      console.error("[ops/slack/events] async processing failed:", message);
      void notify({
        channel: "alerts",
        text: `🚨 Slack events async processing failed: ${message}`,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
