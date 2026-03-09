#!/usr/bin/env node
/**
 * Abra Email Ingest — Gmail → Supabase email_events pipeline.
 *
 * Reads Gmail messages, classifies them, generates embeddings via the
 * embed-and-store edge function, and persists to the email_events table.
 *
 * Usage:
 *   node scripts/abra-email-ingest.mjs --backfill --max 500
 *   node scripts/abra-email-ingest.mjs                        # incremental (default 50)
 *   node scripts/abra-email-ingest.mjs --max 100
 *
 * Requires:
 *   - ~/.config/usa-gummies-mcp/gmail-token.json   (run `node scripts/gmail.mjs auth` first)
 *   - ~/.config/usa-gummies-mcp/google-oauth-client.json
 *   - SUPABASE_URL + SERVICE_ROLE_JWT env vars (or defaults)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const TOKEN_PATH = path.join(CONFIG_DIR, "gmail-token.json");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "google-oauth-client.json");
const CURSOR_PATH = path.join(CONFIG_DIR, "abra-email-ingest-cursor.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zdvfllvopocptwgummzb.supabase.co";
const SERVICE_ROLE_JWT = process.env.SERVICE_ROLE_JWT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const EMBED_URL = `${SUPABASE_URL}/functions/v1/embed-and-store`;
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const MAX_BODY_LENGTH = 45_000; // stay under edge function 50KB limit
const DEFAULT_BATCH = 50;
const EMBED_DELAY_MS = 200; // throttle between embed calls

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { backfill: false, max: DEFAULT_BATCH, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--backfill") args.backfill = true;
    if (argv[i] === "--dry-run") args.dryRun = true;
    if (argv[i] === "--max" && argv[i + 1]) args.max = parseInt(argv[++i], 10);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Gmail Auth (reuses gmail.mjs token file)
// ---------------------------------------------------------------------------

function buildGmailClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`OAuth client JSON not found: ${CREDENTIALS_PATH}\nDownload from GCP Console.`);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Token not found: ${TOKEN_PATH}\nRun: node scripts/gmail.mjs auth`);
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const cfg = raw.installed || raw.web;
  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uris?.[0]);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oauth2.setCredentials(token);

  return google.gmail({ version: "v1", auth: oauth2 });
}

// ---------------------------------------------------------------------------
// MIME body extraction (mirrors gmail-reader.ts)
// ---------------------------------------------------------------------------

function decodeBody(data) {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractTextBody(payload) {
  let text = "";
  let html = "";

  if (payload.body?.data && payload.mimeType === "text/plain") {
    text = decodeBody(payload.body.data);
  } else if (payload.body?.data && payload.mimeType === "text/html") {
    html = decodeBody(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBody(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBody(part.body.data);
      }
      if (part.parts) {
        for (const sub of part.parts) {
          if (sub.mimeType === "text/plain" && sub.body?.data) text = decodeBody(sub.body.data);
          else if (sub.mimeType === "text/html" && sub.body?.data) html = decodeBody(sub.body.data);
        }
      }
    }
  }

  // Prefer plain text; fall back to HTML stripped of tags
  if (text) return text;
  if (html) return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function parseSenderName(fromHeader) {
  // "Ben Stutman <ben@usagummies.com>" → "Ben Stutman"
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : fromHeader.split("@")[0];
}

function parseSenderEmail(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Classification (matches email_events CHECK constraints)
// ---------------------------------------------------------------------------

// category CHECK: production, sales, finance, retail, marketplace, regulatory, customer, compliance, noise
// priority CHECK: critical, important, informational, noise

function classifyEmail(from, subject, body) {
  const text = `${from} ${subject} ${(body || "").slice(0, 500)}`.toLowerCase();

  // Category detection
  let category = "noise";
  if (/faire|wholesale|buyer|distributor|b2b|retailer|broker|clip.?strip/i.test(text)) {
    category = "sales";
  } else if (/amazon|seller.?central|fba|asin|sp-api|marketplace/i.test(text)) {
    category = "marketplace";
  } else if (/shopify|storefront|dtc|direct.to.consumer|ecommerce/i.test(text)) {
    category = "retail";
  } else if (/invoice|payment|payable|receivable|tax|accounting|quickbooks|stripe/i.test(text)) {
    category = "finance";
  } else if (/refund|return|complaint|support|customer|review|feedback/i.test(text)) {
    category = "customer";
  } else if (/production|manufacturing|inventory|warehouse|fulfillment|shipping|3pl|repacker/i.test(text)) {
    category = "production";
  } else if (/fda|compliance|regulation|label|nutrition.?fact|certificate|organic/i.test(text)) {
    category = "regulatory";
  } else if (/compliance|audit|inspection|recall|safety/i.test(text)) {
    category = "compliance";
  }

  // Priority detection
  let priority = "informational";
  if (/urgent|asap|critical|immediate|emergency/i.test(text)) {
    priority = "critical";
  } else if (/faire|wholesale|order|purchase.?order|quote|pricing|payment/i.test(text)) {
    priority = "important";
  } else if (/newsletter|unsubscribe|promo|no-?reply|noreply|marketing/i.test(text)) {
    priority = "noise";
  }

  // Action required?
  const actionRequired = /action.?required|please.?respond|reply.?needed|follow.?up|rsvp|confirm/i.test(text)
    || priority === "critical";

  // Suggested action
  let suggestedAction = null;
  if (actionRequired) {
    if (category === "sales") suggestedAction = "Review and respond to sales inquiry";
    else if (category === "customer") suggestedAction = "Address customer issue";
    else if (category === "finance") suggestedAction = "Review financial matter";
    else suggestedAction = "Review and respond";
  }

  return { category, priority, action_required: actionRequired, suggested_action: suggestedAction };
}

function summarize(subject, body) {
  const combined = `${subject || ""}\n${body || ""}`.trim();
  if (combined.length <= 500) return combined;
  // Truncate at sentence boundary
  const truncated = combined.slice(0, 500);
  const lastPeriod = truncated.lastIndexOf(".");
  if (lastPeriod > 200) return truncated.slice(0, lastPeriod + 1);
  return truncated + "...";
}

// ---------------------------------------------------------------------------
// Supabase helpers (raw fetch — no SDK needed)
// ---------------------------------------------------------------------------

async function supabaseGet(path, params = "") {
  const url = `${REST_URL}${path}${params ? "?" + params : ""}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_JWT,
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`);
  return res.json();
}

async function supabaseDelete(path) {
  const res = await fetch(`${REST_URL}${path}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_JWT,
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${path} failed: ${res.status}`);
}

async function embedAndStore(record) {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
    body: JSON.stringify({ table: "email_events", record }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`embed-and-store failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Dedup — check which message IDs already exist
// ---------------------------------------------------------------------------

async function getExistingMessageIds(messageIds) {
  if (!messageIds.length) return new Set();
  // PostgREST in.() filter — batch into chunks of 50
  const existing = new Set();
  for (let i = 0; i < messageIds.length; i += 50) {
    const chunk = messageIds.slice(i, i + 50);
    const filter = `provider_message_id=in.(${chunk.map((id) => `"${id}"`).join(",")})`;
    const rows = await supabaseGet("/email_events", `select=provider_message_id&${filter}`);
    for (const row of rows) {
      existing.add(row.provider_message_id);
    }
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Cursor state
// ---------------------------------------------------------------------------

function loadCursor() {
  try {
    return JSON.parse(fs.readFileSync(CURSOR_PATH, "utf8"));
  } catch {
    return { lastIngestedAt: null, totalIngested: 0 };
  }
}

function saveCursor(cursor) {
  fs.mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
  fs.writeFileSync(CURSOR_PATH, JSON.stringify(cursor, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Main ingest loop
// ---------------------------------------------------------------------------

async function ingest(gmail, args) {
  const cursor = loadCursor();
  const isBackfill = args.backfill;
  const maxMessages = args.max;
  const dryRun = args.dryRun;

  // Build Gmail search query for incremental runs
  let query = undefined;
  if (!isBackfill && cursor.lastIngestedAt) {
    // Gmail query: after:YYYY/MM/DD
    const d = new Date(cursor.lastIngestedAt);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    query = `after:${dateStr}`;
    console.log(`Incremental mode: fetching emails after ${dateStr}`);
  } else {
    console.log(isBackfill ? "Backfill mode: fetching all emails" : "First run: fetching all emails");
  }

  // Paginate through Gmail messages
  let pageToken = undefined;
  let totalFetched = 0;
  let totalIngested = 0;
  let totalSkipped = 0;
  let latestReceivedAt = cursor.lastIngestedAt;

  while (totalFetched < maxMessages) {
    const pageSize = Math.min(100, maxMessages - totalFetched);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: pageSize,
      q: query,
      pageToken,
    });

    const messages = listRes.data.messages || [];
    if (!messages.length) {
      console.log("No more messages.");
      break;
    }

    const messageIds = messages.map((m) => m.id);
    totalFetched += messages.length;

    // Dedup check
    const existing = await getExistingMessageIds(messageIds);
    const newMessages = messages.filter((m) => !existing.has(m.id));
    totalSkipped += messages.length - newMessages.length;

    if (newMessages.length > 0) {
      console.log(`Page: ${messages.length} messages, ${newMessages.length} new, ${existing.size} already ingested`);
    }

    // Process each new message
    for (const msg of newMessages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const headers = detail.data.payload?.headers || [];
        const from = getHeader(headers, "From");
        const subject = getHeader(headers, "Subject");
        const dateStr = getHeader(headers, "Date");
        const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

        const bodyText = extractTextBody(detail.data.payload || {});
        const truncatedBody = bodyText.slice(0, MAX_BODY_LENGTH);

        const { category, priority, action_required, suggested_action } = classifyEmail(from, subject, bodyText);
        const summary = summarize(subject, bodyText);

        const record = {
          provider_message_id: msg.id,
          source_thread_id: msg.threadId || null,
          sender_name: parseSenderName(from),
          sender_email: parseSenderEmail(from),
          subject: (subject || "").slice(0, 500),
          received_at: receivedAt,
          raw_text: truncatedBody || summary || subject || "(empty)",
          summary,
          category,
          priority,
          action_required,
          suggested_action,
          status: "new",
        };

        if (dryRun) {
          console.log(`  [DRY] ${msg.id} | ${category}/${priority} | ${subject?.slice(0, 60)}`);
        } else {
          await embedAndStore(record);
          console.log(`  ✓ ${msg.id} | ${category}/${priority} | ${subject?.slice(0, 60)}`);
        }

        totalIngested++;

        // Track latest timestamp
        if (!latestReceivedAt || receivedAt > latestReceivedAt) {
          latestReceivedAt = receivedAt;
        }

        // Throttle to avoid overwhelming embed function
        await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
      } catch (err) {
        console.error(`  ✗ ${msg.id}: ${err.message}`);
      }
    }

    // Next page
    pageToken = listRes.data.nextPageToken;
    if (!pageToken) break;
  }

  // Save cursor
  if (!dryRun && latestReceivedAt) {
    cursor.lastIngestedAt = latestReceivedAt;
    cursor.totalIngested = (cursor.totalIngested || 0) + totalIngested;
    saveCursor(cursor);
  }

  console.log(`\nDone. Fetched: ${totalFetched}, Ingested: ${totalIngested}, Skipped (dedup): ${totalSkipped}`);
  return { totalFetched, totalIngested, totalSkipped };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!SERVICE_ROLE_JWT) {
    console.error("Missing SERVICE_ROLE_JWT or SUPABASE_SERVICE_ROLE_KEY env var.");
    process.exit(1);
  }

  console.log("Abra Email Ingest");
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Mode: ${args.backfill ? "backfill" : "incremental"}`);
  console.log(`  Max: ${args.max}`);
  console.log(`  Dry run: ${args.dryRun}`);
  console.log();

  const gmail = buildGmailClient();
  await ingest(gmail, args);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
