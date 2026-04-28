/**
 * Cloud-compatible Gmail inbox reader via Gmail API (googleapis).
 *
 * Replaces scripts/check-email.sh (himalaya CLI IMAP) for Vercel-hosted agents.
 * Uses OAuth2 with a service account or app password via Gmail API REST.
 *
 * Usage:
 *   import { listEmails, readEmail } from "@/lib/ops/gmail-reader";
 *   const emails = await listEmails({ folder: "INBOX", count: 20 });
 *   const body = await readEmail(messageId);
 */

import { google } from "googleapis";
import { extractPdfTextFromBuffer } from "@/lib/ops/file-text-extraction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailEnvelope = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
};

export type EmailAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type EmailAttachmentContent = EmailAttachment & {
  data: Buffer;
  textContent?: string; // extracted text for PDFs, spreadsheets, text files
};

export type EmailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string; // plain text body
  htmlBody?: string;
  labelIds: string[];
  attachments: EmailAttachment[];
};

export type SentDraftDetails = {
  ok: true;
  draftId: string;
  messageId: string;
  threadId: string | null;
  to: string;
  from: string;
  subject: string;
  body: string;
};

export type ListEmailsOpts = {
  folder?: string; // Gmail label: INBOX, SENT, etc.
  count?: number;
  query?: string; // Gmail search query (e.g., "from:faire.com")
  unreadOnly?: boolean;
};

// ---------------------------------------------------------------------------
// Auth — Gmail API with OAuth2 (Gmail app password won't work for API;
// we use a service account or OAuth refresh token)
// ---------------------------------------------------------------------------

let _gmail: ReturnType<typeof google.gmail> | null = null;
let _gmailSend: ReturnType<typeof google.gmail> | null = null;

function getGmailClient() {
  if (_gmail) return _gmail;

  // Option 1: Service account JSON (preferred for automation)
  const saJson = process.env.GMAIL_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      clientOptions: {
        subject: "ben@usagummies.com", // domain-wide delegation
      },
    });
    _gmail = google.gmail({ version: "v1", auth });
    return _gmail;
  }

  // Option 2: OAuth2 refresh token (accept both GMAIL_OAUTH_* and GCP_GMAIL_OAUTH_* naming)
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    _gmail = google.gmail({ version: "v1", auth: oauth2 });
    return _gmail;
  }

  throw new Error(
    "Gmail API not configured. Set GMAIL_SERVICE_ACCOUNT_JSON, or set GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET + GMAIL_OAUTH_REFRESH_TOKEN."
  );
}

/**
 * Get a Gmail client with send permission.
 * Uses OAuth2 (scopes are baked into the refresh token) or service account
 * with gmail.send scope. Returns null if not available.
 */
function getGmailSendClient(): ReturnType<typeof google.gmail> | null {
  if (_gmailSend) return _gmailSend;

  // OAuth2 refresh token — scopes are baked in from when the token was created.
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    console.log("[gmail-reader] getGmailSendClient: OAuth2 credentials found, creating client");
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    _gmailSend = google.gmail({ version: "v1", auth: oauth2 });
    return _gmailSend;
  }

  // Service account with send scope
  const saJson = process.env.GMAIL_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    console.log("[gmail-reader] getGmailSendClient: Service account found, creating client");
    const creds = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      clientOptions: {
        subject: "ben@usagummies.com",
      },
    });
    _gmailSend = google.gmail({ version: "v1", auth });
    return _gmailSend;
  }

  console.warn(
    "[gmail-reader] getGmailSendClient: NO credentials found. " +
    `Checked: GMAIL_OAUTH_CLIENT_ID=${!!process.env.GMAIL_OAUTH_CLIENT_ID}, ` +
    `GCP_GMAIL_OAUTH_CLIENT_ID=${!!process.env.GCP_GMAIL_OAUTH_CLIENT_ID}, ` +
    `GMAIL_OAUTH_CLIENT_SECRET=${!!process.env.GMAIL_OAUTH_CLIENT_SECRET}, ` +
    `GCP_GMAIL_OAUTH_CLIENT_SECRET=${!!process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET}, ` +
    `GMAIL_OAUTH_REFRESH_TOKEN=${!!process.env.GMAIL_OAUTH_REFRESH_TOKEN}, ` +
    `GCP_GMAIL_OAUTH_REFRESH_TOKEN=${!!process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN}, ` +
    `GMAIL_SERVICE_ACCOUNT_JSON=${!!process.env.GMAIL_SERVICE_ACCOUNT_JSON}`
  );
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBody(data: string): string {
  // Gmail API returns base64url-encoded body
  return Buffer.from(data, "base64url").toString("utf-8");
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  headers?: Array<{ name: string; value: string }>;
  parts?: GmailPart[];
};

type GmailPayload = GmailPart;

function extractAttachments(payload: GmailPayload): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  function walk(parts: GmailPart[] | undefined) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }
  // Top-level part might itself be an attachment (rare)
  if (payload.filename && payload.body?.attachmentId) {
    attachments.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename,
      mimeType: payload.mimeType || "application/octet-stream",
      size: payload.body.size || 0,
    });
  }
  walk(payload.parts);
  return attachments;
}

function extractTextBody(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: Array<{
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  }>;
}): { text: string; html: string } {
  let text = "";
  let html = "";

  // Simple body (no MIME parts)
  if (payload.body?.data && payload.mimeType === "text/plain") {
    text = decodeBody(payload.body.data);
  } else if (payload.body?.data && payload.mimeType === "text/html") {
    html = decodeBody(payload.body.data);
  }

  // Multipart
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBody(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBody(part.body.data);
      }
      // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
      if (part.parts) {
        for (const subpart of part.parts) {
          if (subpart.mimeType === "text/plain" && subpart.body?.data) {
            text = decodeBody(subpart.body.data);
          } else if (subpart.mimeType === "text/html" && subpart.body?.data) {
            html = decodeBody(subpart.body.data);
          }
        }
      }
    }
  }

  return { text, html };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Exponential backoff retry helper with jitter */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
        const delay = baseDelayMs * Math.pow(2, attempt) * jitter;
        await new Promise((resolve) => setTimeout(resolve, Math.round(delay)));
      }
    }
  }
  throw lastError;
}

/**
 * List email envelopes (subject, from, date, snippet).
 */
export async function listEmails(opts: ListEmailsOpts = {}): Promise<EmailEnvelope[]> {
  const gmail = getGmailClient();
  const { folder = "INBOX", count = 20, query, unreadOnly } = opts;

  // Build Gmail query
  const parts: string[] = [];
  if (folder && folder !== "INBOX") {
    parts.push(`in:${folder.toLowerCase()}`);
  }
  if (query) parts.push(query);
  if (unreadOnly) parts.push("is:unread");

  const q = parts.length > 0 ? parts.join(" ") : undefined;
  const labelIds = folder === "INBOX" ? ["INBOX"] : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listRes: any;
  try {
    listRes = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        maxResults: count,
        q,
        labelIds,
      }),
    );
  } catch (err) {
    console.warn(
      `[gmail-reader] listEmails failed after retries (folder=${folder}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const messages: Array<{ id?: string | null; threadId?: string | null }> =
    listRes?.data?.messages ?? [];
  const envelopes: EmailEnvelope[] = [];

  // Batch-fetch metadata for each message (with per-message timeout to prevent cascading hangs)
  const BATCH_SIZE = 5;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE).filter((msg) => msg.id);
    const results = await Promise.allSettled(
      batch.map(async (msg) => {
        const detail = await Promise.race([
          gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("message metadata timeout")), 10000),
          ),
        ]);
        const headers = (detail.data.payload?.headers ?? []) as Array<{
          name: string;
          value: string;
        }>;
        return {
          id: msg.id!,
          threadId: msg.threadId ?? "",
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          subject: getHeader(headers, "Subject"),
          date: getHeader(headers, "Date"),
          snippet: detail.data.snippet ?? "",
          labelIds: (detail.data.labelIds ?? []) as string[],
        } as EmailEnvelope;
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") envelopes.push(result.value);
    }
  }

  return envelopes;
}

/**
 * Read a full email message by ID.
 */
export async function readEmail(messageId: string): Promise<EmailMessage | null> {
  const gmail = getGmailClient();

  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = (res.data.payload?.headers ?? []) as Array<{
      name: string;
      value: string;
    }>;
    const payload = (res.data.payload || {}) as GmailPayload;
    const { text, html } = extractTextBody(payload);
    const attachments = extractAttachments(payload);

    return {
      id: messageId,
      threadId: res.data.threadId ?? "",
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      body: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      htmlBody: html || undefined,
      labelIds: (res.data.labelIds ?? []) as string[],
      attachments,
    };
  } catch {
    return null;
  }
}

/**
 * Search emails and return full messages.
 */
export async function searchEmails(
  query: string,
  count = 10
): Promise<EmailMessage[]> {
  const envelopes = await listEmails({ query, count });
  const messages: EmailMessage[] = [];

  for (const env of envelopes) {
    const msg = await readEmail(env.id);
    if (msg) messages.push(msg);
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Attachment reading
// ---------------------------------------------------------------------------

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB cap for serverless

/**
 * Download raw attachment content by message ID + attachment ID.
 */
export async function getAttachmentContent(
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  return Buffer.from(res.data.data || "", "base64url");
}

/**
 * Read an attachment and extract text content where possible.
 * Supports PDFs (pdfjs-dist), spreadsheets (xlsx), and plain text files.
 * Images and unsupported types return metadata only (no textContent).
 * Enforces 5MB size cap to avoid OOM on serverless.
 */
export async function readAttachment(
  messageId: string,
  attachment: EmailAttachment,
): Promise<EmailAttachmentContent> {
  if (attachment.size > MAX_ATTACHMENT_SIZE) {
    return {
      ...attachment,
      data: Buffer.alloc(0),
      textContent: `[Attachment too large: ${(attachment.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB]`,
    };
  }

  const data = await getAttachmentContent(messageId, attachment.attachmentId);
  let textContent: string | undefined;

  const mime = attachment.mimeType.toLowerCase();
  const ext = attachment.filename.toLowerCase();

  try {
    // PDF extraction via shared pdfjs-dist helper
    if (mime === "application/pdf" || ext.endsWith(".pdf")) {
      const extracted = await extractPdfTextFromBuffer(data, {
        maxPages: 50,
        maxChars: 50_000,
        scannedPlaceholder: "[Scanned PDF — no extractable text. Needs OCR.]",
      });
      textContent = extracted.text || undefined;
    }
    // Spreadsheets (xlsx, xls, csv)
    else if (
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.ms-excel" ||
      ext.endsWith(".xlsx") ||
      ext.endsWith(".xls")
    ) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(data, { type: "buffer" });
      const sheets = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(sheet)}`;
      });
      textContent = sheets.join("\n\n").trim() || undefined;
    }
    // CSV / plain text / JSON
    else if (
      mime.startsWith("text/") ||
      ext.endsWith(".csv") ||
      ext.endsWith(".json") ||
      ext.endsWith(".txt")
    ) {
      textContent = data.toString("utf-8").trim() || undefined;
    }
    // Images — metadata only, no text extraction
    else if (mime.startsWith("image/")) {
      textContent = `[Image: ${attachment.filename} (${mime}, ${(attachment.size / 1024).toFixed(0)}KB)]`;
    }
  } catch (err) {
    textContent = `[Failed to extract text from ${attachment.filename}: ${err instanceof Error ? err.message : "unknown error"}]`;
  }

  return { ...attachment, data, textContent };
}

/**
 * Convenience: read all attachments for a message, extract text where possible.
 * Skips inline images (tiny attachments < 1KB are likely email signatures).
 */
export async function readAllAttachments(
  messageId: string,
  attachments: EmailAttachment[],
): Promise<EmailAttachmentContent[]> {
  const results: EmailAttachmentContent[] = [];
  for (const att of attachments) {
    // Skip tiny inline images (email signatures, tracking pixels)
    if (att.size < 1024 && att.mimeType.startsWith("image/")) continue;
    try {
      const content = await readAttachment(messageId, att);
      results.push(content);
    } catch {
      results.push({
        ...att,
        data: Buffer.alloc(0),
        textContent: `[Failed to download ${att.filename}]`,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Sending via Gmail API (saves to Sent folder automatically)
// ---------------------------------------------------------------------------

export type SendGmailOpts = {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  threadId?: string; // Gmail thread ID to reply in-thread
  inReplyTo?: string; // RFC 2822 Message-ID of the message we're replying to
  references?: string; // RFC 2822 References chain
  attachments?: Array<{
    filename: string;
    mimeType: string;
    content: Buffer | Uint8Array;
  }>;
  htmlBody?: string;
};

/**
 * Build a raw RFC 2822 email message encoded as base64url for the Gmail API.
 *
 * Supports:
 *   - plain text body (opts.body)
 *   - optional HTML alternative (opts.htmlBody)
 *   - file attachments (opts.attachments) as base64-encoded MIME parts
 *   - reply threading via In-Reply-To / References headers
 *
 * Format picked:
 *   - No attachments, plain only     → text/plain top-level
 *   - No attachments, plain + html   → multipart/alternative
 *   - Any attachments                → multipart/mixed with an
 *                                       alternative part inside
 */
/**
 * RFC 2047-encode a header value if it contains non-ASCII characters.
 * Without this, characters like em-dash (U+2014), curly quotes, and
 * accented letters render as garbled mojibake in many mail clients
 * AND increase the spam-flag risk because raw 8-bit bytes in
 * headers violate RFC 5322.
 *
 * Format: `=?UTF-8?B?<base64-of-utf8-bytes>?=` — the standard encoded-
 * word form Gmail / Outlook / iOS Mail all decode correctly.
 *
 * Pure ASCII passes through unchanged.
 *
 * Locked by Rene's 2026-04-27 walkthrough: an em-dash in the
 * `lead.auto-ack` subject was rendering as garbled bytes at the top
 * of the email, contributing to both spam-flagging + a confusing
 * "weird writing" UX.
 */
function encodeHeaderRfc2047(value: string): string {
  // Fast path: pure ASCII (codepoints 32-126 + tab) needs no encoding.
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E\t]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function buildRawEmail(opts: SendGmailOpts): string {
  const from = encodeHeaderRfc2047(
    opts.from || "Ben Stutman <ben@usagummies.com>",
  );
  const subject = encodeHeaderRfc2047(opts.subject ?? "");
  const hasAttachments = Array.isArray(opts.attachments) && opts.attachments.length > 0;
  const hasHtml = typeof opts.htmlBody === "string" && opts.htmlBody.length > 0;

  // Simple case: no attachments, plain-text only.
  if (!hasAttachments && !hasHtml) {
    const lines = [
      `From: ${from}`,
      `To: ${opts.to}`,
      ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
      ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
      ...(opts.references ? [`References: ${opts.references}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      opts.body,
    ];
    return Buffer.from(lines.join("\r\n")).toString("base64url");
  }

  // Boundaries — independent for alternative vs mixed so nesting is clean.
  const altBoundary = `alt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const mixBoundary = `mix-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Body part (text/plain optionally with html alternative).
  const bodyBlock: string[] = [];
  if (hasHtml) {
    bodyBlock.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    bodyBlock.push("");
    bodyBlock.push(`--${altBoundary}`);
    bodyBlock.push("Content-Type: text/plain; charset=UTF-8");
    bodyBlock.push("Content-Transfer-Encoding: 7bit");
    bodyBlock.push("");
    bodyBlock.push(opts.body);
    bodyBlock.push("");
    bodyBlock.push(`--${altBoundary}`);
    bodyBlock.push("Content-Type: text/html; charset=UTF-8");
    bodyBlock.push("Content-Transfer-Encoding: 7bit");
    bodyBlock.push("");
    bodyBlock.push(opts.htmlBody ?? "");
    bodyBlock.push("");
    bodyBlock.push(`--${altBoundary}--`);
  } else {
    bodyBlock.push("Content-Type: text/plain; charset=UTF-8");
    bodyBlock.push("Content-Transfer-Encoding: 7bit");
    bodyBlock.push("");
    bodyBlock.push(opts.body);
  }

  if (!hasAttachments) {
    const lines = [
      `From: ${from}`,
      `To: ${opts.to}`,
      ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
      ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
      ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
      ...(opts.references ? [`References: ${opts.references}`] : []),
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      ...bodyBlock,
    ];
    return Buffer.from(lines.join("\r\n")).toString("base64url");
  }

  // Multipart/mixed with attachments.
  const parts: string[] = [];
  parts.push(`--${mixBoundary}`);
  parts.push(...bodyBlock);
  parts.push("");

  for (const att of opts.attachments ?? []) {
    const b64 =
      att.content instanceof Buffer
        ? att.content.toString("base64")
        : Buffer.from(att.content).toString("base64");
    // Wrap base64 at 76 chars per RFC 2045.
    const wrapped = b64.replace(/(.{76})/g, "$1\r\n");
    parts.push(`--${mixBoundary}`);
    parts.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
    parts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(wrapped);
  }
  parts.push(`--${mixBoundary}--`);

  const lines = [
    `From: ${from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
    "",
    ...parts,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

/**
 * Detailed variant of `sendViaGmailApi` that returns the Gmail message
 * id + thread id on success, and a structured error on failure. Callers
 * that need to log the sent message id (e.g. AP-packet send flow) use
 * this; legacy callers that just need ok/fail keep using the boolean
 * `sendViaGmailApi` below.
 */
export async function sendViaGmailApiDetailed(
  opts: SendGmailOpts,
): Promise<
  | { ok: true; messageId: string; threadId: string | null }
  | { ok: false; error: string }
> {
  const gmail = getGmailSendClient();
  if (!gmail) {
    return { ok: false, error: "Gmail send client not available" };
  }
  try {
    const raw = buildRawEmail(opts);
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      },
    });
    const messageId = response.data?.id ?? "";
    if (!messageId) {
      return { ok: false, error: "Gmail API returned no message id" };
    }
    return {
      ok: true,
      messageId,
      threadId: response.data?.threadId ?? null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errMsg };
  }
}

/**
 * Send an email via Gmail API. Automatically saves to Sent folder.
 * Returns true on success, false if Gmail API send is unavailable or fails.
 * Callers should fall back to SMTP on false.
 */
export async function sendViaGmailApi(opts: SendGmailOpts): Promise<boolean> {
  const gmail = getGmailSendClient();
  if (!gmail) {
    console.warn("[gmail-reader] sendViaGmailApi: No Gmail send client available — will fall back to SMTP");
    return false;
  }

  try {
    const raw = buildRawEmail(opts);
    console.log(`[gmail-reader] sendViaGmailApi: Sending to ${opts.to}, subject: "${opts.subject?.slice(0, 60)}"`);
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      },
    });
    console.log(`[gmail-reader] sendViaGmailApi: SUCCESS — message ID: ${response.data?.id}, threadId: ${response.data?.threadId}`);
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errDetail = err instanceof Error && "response" in err
      ? JSON.stringify((err as Record<string, unknown>).response ?? "").slice(0, 500)
      : "";
    console.error(
      `[gmail-reader] sendViaGmailApi FAILED (will fall back to SMTP): ${errMsg}`,
      errDetail ? `\nResponse detail: ${errDetail}` : "",
    );
    return false;
  }
}

/**
 * Create a Gmail DRAFT (not a send) via the Gmail API. The draft lives
 * in the sender's Drafts folder; a human opens Gmail, reviews, and
 * clicks Send. Used for any Class B+ outbound email where we want the
 * human in the loop without making them hand-type the body.
 *
 * Supports attachments + reply threading the same way sendViaGmailApi
 * does. Returns the Gmail draft id + permalink the user can open in
 * their browser.
 */
export async function createGmailDraft(
  opts: SendGmailOpts,
): Promise<
  | { ok: true; draftId: string; messageId: string; threadId: string | null; openUrl: string }
  | { ok: false; error: string }
> {
  const gmail = getGmailSendClient();
  if (!gmail) {
    return { ok: false, error: "Gmail send client not available" };
  }
  try {
    const raw = buildRawEmail(opts);
    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw,
          ...(opts.threadId ? { threadId: opts.threadId } : {}),
        },
      },
    });
    const draftId = response.data?.id;
    const messageId = response.data?.message?.id ?? "";
    const threadId = response.data?.message?.threadId ?? null;
    if (!draftId) {
      return { ok: false, error: "Gmail API returned no draft id" };
    }
    // Gmail's deeplink to a specific draft. `#drafts/<id>` opens the
    // Drafts view with the draft selected.
    const openUrl = threadId
      ? `https://mail.google.com/mail/u/0/#all/${threadId}`
      : `https://mail.google.com/mail/u/0/#drafts`;
    return { ok: true, draftId, messageId, threadId, openUrl };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gmail draft create failed: ${errMsg}` };
  }
}

/**
 * Send an existing Gmail draft by id. Used by the Slack approval closer:
 * the draft is created during the email-intel scan, then Ben approves the
 * Class B `gmail.send` card, then this sends exactly that reviewed draft.
 */
export async function sendGmailDraftDetailed(
  draftId: string,
): Promise<SentDraftDetails | { ok: false; error: string }> {
  const gmail = getGmailSendClient();
  if (!gmail) {
    return { ok: false, error: "Gmail send client not available" };
  }

  try {
    const draft = await gmail.users.drafts.get({
      userId: "me",
      id: draftId,
      format: "full",
    });
    const message = draft.data.message;
    const payload = message?.payload as GmailPayload | undefined;
    const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;
    const bodyParts = payload ? extractTextBody(payload) : { text: "", html: "" };

    const sent = await gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });
    const messageId = sent.data?.id ?? "";
    if (!messageId) {
      return { ok: false, error: "Gmail API returned no sent message id" };
    }

    return {
      ok: true,
      draftId,
      messageId,
      threadId: sent.data?.threadId ?? message?.threadId ?? null,
      to: getHeader(headers, "To"),
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      body: bodyParts.text || bodyParts.html || message?.snippet || "",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Diagnostic version of sendViaGmailApi — returns detailed error info instead of boolean.
 */
export async function testGmailApiSendDiagnostic(opts: SendGmailOpts): Promise<{
  ok: boolean;
  messageId?: string;
  clientAvailable: boolean;
  error?: string;
  errorCode?: number;
  errorDetail?: string;
}> {
  const gmail = getGmailSendClient();
  if (!gmail) {
    return { ok: false, clientAvailable: false, error: "No Gmail send client — OAuth credentials missing or invalid" };
  }

  try {
    const raw = buildRawEmail(opts);
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return { ok: true, clientAvailable: true, messageId: response.data?.id || undefined };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    let errorCode: number | undefined;
    let errorDetail: string | undefined;

    if (err && typeof err === "object") {
      const errObj = err as Record<string, unknown>;
      if (errObj.code) errorCode = Number(errObj.code);
      if (errObj.response && typeof errObj.response === "object") {
        const resp = errObj.response as Record<string, unknown>;
        errorCode = errorCode || (resp.status ? Number(resp.status) : undefined);
        errorDetail = JSON.stringify(resp.data ?? resp.statusText ?? "").slice(0, 1000);
      }
      if (errObj.errors) {
        errorDetail = (errorDetail || "") + " | errors: " + JSON.stringify(errObj.errors).slice(0, 500);
      }
    }

    return {
      ok: false,
      clientAvailable: true,
      error: errMsg,
      errorCode,
      errorDetail,
    };
  }
}
