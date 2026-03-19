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
  // If the token was created with gmail.send scope, this will work.
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GCP_GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    _gmailSend = google.gmail({ version: "v1", auth: oauth2 });
    return _gmailSend;
  }

  // Service account with send scope
  const saJson = process.env.GMAIL_SERVICE_ACCOUNT_JSON;
  if (saJson) {
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

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults: count,
    q,
    labelIds,
  });

  const messages = listRes.data.messages ?? [];
  const envelopes: EmailEnvelope[] = [];

  // Batch-fetch metadata for each message
  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = (detail.data.payload?.headers ?? []) as Array<{
        name: string;
        value: string;
      }>;
      envelopes.push({
        id: msg.id,
        threadId: msg.threadId ?? "",
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        date: getHeader(headers, "Date"),
        snippet: detail.data.snippet ?? "",
        labelIds: (detail.data.labelIds ?? []) as string[],
      });
    } catch {
      // Skip messages we can't read
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
 * Supports PDFs (pdf-parse), spreadsheets (xlsx), and plain text files.
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
    // PDF extraction via pdfjs-dist (low-level, avoids pdf-parse v2 API issues)
    if (mime === "application/pdf" || ext.endsWith(".pdf")) {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: Record<string, unknown>) => (item as { str?: string }).str || "")
          .join(" ");
        if (pageText.trim()) pages.push(pageText.trim());
      }
      textContent = pages.join("\n\n").trim() || undefined;
      // Detect scanned PDFs (image-only, no extractable text)
      if (!textContent || textContent.length < 20) {
        textContent = "[Scanned PDF — no extractable text. Needs OCR.]";
      }
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
  threadId?: string; // Gmail thread ID to reply in-thread
};

/**
 * Build a raw RFC 2822 email message encoded as base64url for the Gmail API.
 */
function buildRawEmail(opts: SendGmailOpts): string {
  const from = opts.from || "Ben Stutman <ben@usagummies.com>";
  const lines = [
    `From: ${from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.body,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

/**
 * Send an email via Gmail API. Automatically saves to Sent folder.
 * Returns true on success, false if Gmail API send is unavailable or fails.
 * Callers should fall back to SMTP on false.
 */
export async function sendViaGmailApi(opts: SendGmailOpts): Promise<boolean> {
  const gmail = getGmailSendClient();
  if (!gmail) return false;

  try {
    const raw = buildRawEmail(opts);
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      },
    });
    return true;
  } catch (err) {
    console.error(
      "[gmail-reader] sendViaGmailApi failed (will fall back to SMTP):",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
