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

  // Option 2: OAuth2 refresh token
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    _gmail = google.gmail({ version: "v1", auth: oauth2 });
    return _gmail;
  }

  throw new Error(
    "Gmail API not configured. Set GMAIL_SERVICE_ACCOUNT_JSON or GMAIL_OAUTH_* env vars."
  );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { text, html } = extractTextBody(res.data.payload as any);

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
