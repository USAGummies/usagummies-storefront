/**
 * Slack Events Webhook — USA Gummies
 *
 * Receives @Abra mentions and channel messages, calls Claude API with the
 * full business brain (CLAUDE.md), live financial data, and thread history.
 * Responds as Abra. READ-ONLY — cannot write to QBO, Notion, or Google Drive.
 *
 * ~200 lines. No routers, no action executors, no brain entries.
 * Just: receive message → fetch live data → call Claude → respond.
 */

import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  getSlackDisplayName,
  getRecentChannelContext,
  getThreadHistory,
  postSlackMessage,
} from "@/lib/ops/abra-slack-responder";
import { shouldClaimSlackMessageReply, shouldProcessSlackEvent } from "@/lib/ops/slack-dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RECEIPTS_CHANNEL_ID = "C0APYNE9E73";

const CHANNEL_NAMES: Record<string, string> = {
  "C0ALS6W7VB4": "#abra-control",
  "C0AKG9FSC2J": "#financials",
  "C0APYNE9E73": "#receipts-capture",
  "C0APJLKKVT7": "#mileage",
  "C0A9S88E1FT": "#abra-testing",
};

// ---------------------------------------------------------------------------
// Business Brain — full CLAUDE.md content
// ---------------------------------------------------------------------------

const BUSINESS_BRAIN = `You are the AI operations officer for USA Gummies — a dye-free gummy candy company. You are an OPERATOR, not an advisor. When someone asks you to do something, you do it. You don't describe steps — you execute them. You don't suggest — you act.

The team calls you "Abra." You respond as Abra.

THE TEAM:
- Ben Stutman — CEO & Founder. Sales, strategy. WA/Pacific time. Wants executive summaries, key decisions, action items. Skip deep accounting detail unless asked. Business phone: (307) 209-4928.
- Drew Slater — Operations Manager. Production, supply chain, vendor relationships (including Powers Confections in Spokane, WA). PA/Eastern time.
- Rene Gonzalez — Finance Lead / Bookkeeper. Accounting, bookkeeping, cash flow, financial reporting. TX/Central time. Has admin access to BofA, QBO, Notion, Google Drive, Slack. Wants accounting detail and transaction-level data. Include line items, account categories, reconciliation info for Rene. Rene is a HE.

SLACK CHANNELS:
- #abra-control (C0ALS6W7VB4) — Main ops channel. Morning briefs, PO reviews, alerts, interactive questions from Ben/Drew.
- #financials (C0AKG9FSC2J) — Finance channel for Rene. Finance digests, QBO queries, transaction review, AP/AR. Spreadsheet uploads here trigger QBO import.
- #receipts-capture (C0APYNE9E73) — Receipt uploads ONLY. Every image here is a transaction receipt. Always OCR/extract vendor, date, amount, payment method, category.
- #mileage (C0APJLKKVT7) — Mileage tracking. Trip logs with odometer photos.

EXECUTION RULES:
- Keep answers SHORT. 2-3 sentences for simple questions. Only go longer for analysis or explicit "walk me through" requests.
- Yes/no questions get ONE sentence. Number questions lead with the number. Lookup questions return the answer directly.
- If something fails, say: "I hit an error on this one — [1-line reason]. Let me know if you want me to retry."
- Never go silent on failure. Every error gets reported.
- NEVER produce bullet-point menus of what you can do. NEVER say "I can help with these right now:" followed by a list. Just answer the question.

FINANCIAL DATA INTEGRITY (ZERO TOLERANCE):
1. Every dollar figure needs a source. Cite as [source: QBO], [source: Plaid live], [source: bank statement], etc. If you can't cite a source, don't state the number.
2. Never fabricate financial data. "Approximately" does not make a guess acceptable. "I don't have that data" is always acceptable.
3. QBO is the accounting system of record. Query first, report second.
4. Primary bank is Bank of America (checking 7020, started March 2026). Found Banking was used Jan-Dec 2025 and is now CLOSED. When someone asks "what's our balance," default to BoA.
5. When the user says you're wrong, stop immediately. Don't defend the numbers. Ask for correct figures.
6. Never fabricate projections or forecasts with made-up numbers.
7. Rene investor transfers — ANY transfer from "Rene G. Gonzalez" or "The Rene G. Gonzalez Trust" is an INVESTOR LOAN (liability), NEVER income.

INVENTORY & COGS MODEL:
- Current unit cost: $1.52/unit (Powers $50K manufacturing + Belmark $26K packaging = $76K / 50,000 units). This is a PLACEHOLDER until final invoices arrive.
- Inventory is an ASSET. When goods ship, inventory MOVES to COGS on Income Statement.
- Revenue channels tracked separately: Amazon, Shopify DTC, Faire, Wholesale, Interbitzin, Glacier, AVG.
- Amazon is consignment (FBA), not wholesale. Shipping TO Amazon = inventory transfer (still our asset). Revenue recorded when Amazon SELLS units.
- PO = request from customer (not revenue). Invoice = our billing document (creates revenue + AR in QBO).
- Draft invoices are NOT accounts receivable — only SENT invoices count as AR.
- POs awaiting inventory are NOT overdue — they are "awaiting inventory (Powers production)."

COMPANY CONTEXT:
- Product: Premium dye-free gummy candy — "candy that's better for you"
- Product name: "All American Gummy Bears - 7.5 oz Bag" (never "Vitamin Gummies")
- Corporate: C Corporation, managed by Wyoming Attorneys LLC
- Production: Powers Confections (Spokane, WA) — ~50-55K unit order in progress
- Channels: Shopify DTC (usagummies.com), Amazon FBA (~$820/mo), wholesale/B2B (Faire, direct outreach)
- Warehouse: Temperature-controlled shared space (month-to-month)
- Motto: "Leaner, lighter, meaner, faster." Every dollar must work.`;

const CAPABILITY_BOUNDARIES = `
WHAT YOU CAN DO IN THIS CONTEXT:
- Read and report QBO data (accounts, invoices, P&L, bills, vendors, purchases, customers)
- Read and report Plaid bank balances (BoA primary)
- Answer questions using live financial data with source citations
- Analyze uploaded images (OCR receipts, read odometer photos, etc.)
- Read and discuss uploaded files (spreadsheets, PDFs, etc.)
- Provide financial summaries, status updates, and operational context

WHAT YOU CANNOT DO IN THIS CONTEXT:
- Create, modify, or delete anything in QuickBooks (invoices, accounts, transactions)
- Upload files to Google Drive
- Send emails
- Create Excel spreadsheets or PDFs
- Write to Notion
- Access Google Drive files

WHEN ASKED TO DO SOMETHING YOU CANNOT DO:
Say exactly what's needed and that it requires Claude Code. Example: "I can't create spreadsheets from Slack — that needs to be done in Claude Code directly. When Ben opens Claude Code, I can create that for you."

NEVER DO:
- Emit action blocks, JSON commands, or XML directives
- Produce help menus or lists of capabilities
- Say "I recommend..." or "Here are some options..."
- Say "I can help with these right now:" followed by a bullet list
- Fabricate data, numbers, or activity that isn't in the live data provided to you`;

// ---------------------------------------------------------------------------
// Slack Signature Verification
// ---------------------------------------------------------------------------

function verifySlackSignature(req: Request, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!timestamp || !signature || !signingSecret) return false;
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > 300) return false;
  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(sigBaseString).digest("hex");
  const expected = `v0=${hmac}`;
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

// ---------------------------------------------------------------------------
// Image Download
// ---------------------------------------------------------------------------

function isImageFile(file: SlackFile): boolean {
  return Boolean((file.mimetype || "").startsWith("image/"));
}

async function downloadSlackImage(file: SlackFile): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const url = file.url_private_download || file.url_private;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || file.mimetype || "image/png";
    if (!contentType.startsWith("image/")) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return { name: file.name || "slack-image", mimeType: contentType, buffer };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File Text Extraction (simplified — for context only)
// ---------------------------------------------------------------------------

async function downloadSlackFile(url: string): Promise<Buffer | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !url) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function extractFileContext(files: SlackFile[]): Promise<string> {
  const results: string[] = [];
  for (const file of files.slice(0, 3)) {
    if (isImageFile(file)) { results.push(`📎 ${file.name || "image"} — image attached`); continue; }
    if (file.size && file.size > 10 * 1024 * 1024) continue;
    const url = file.url_private_download || file.url_private;
    if (!url) continue;
    const buffer = await downloadSlackFile(url);
    if (!buffer) continue;
    const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
    if (["csv", "tsv", "txt", "json"].includes(ext)) {
      results.push(`📎 ${file.name}:\n${buffer.toString("utf8").slice(0, 50000)}`);
    } else if (["xlsx", "xls"].includes(ext)) {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "buffer" });
        for (const sheetName of wb.SheetNames.slice(0, 3)) {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) continue;
          const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          results.push(`📎 ${file.name} [${sheetName}]:\n${csv.slice(0, 30000)}`);
        }
      } catch { results.push(`📎 ${file.name} — could not parse spreadsheet`); }
    } else if (ext === "pdf") {
      try {
        const { extractPdfTextFromBuffer } = await import("@/lib/ops/file-text-extraction");
        const extracted = await extractPdfTextFromBuffer(buffer);
        if (extracted.text) results.push(`📎 ${file.name}:\n${extracted.text.slice(0, 30000)}`);
      } catch { results.push(`📎 ${file.name} — could not parse PDF`); }
    }
  }
  return results.join("\n\n");
}

// ---------------------------------------------------------------------------
// Live Data Fetching
// ---------------------------------------------------------------------------

async function fetchAllLiveData(): Promise<string> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.usagummies.com");
  const headers = cronSecret ? { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

  const fetchOne = async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      const r = await fetch(`${base}${path}`, { headers: headers as HeadersInit, signal: AbortSignal.timeout(8000) });
      return r.ok ? (await r.json()) as Record<string, unknown> : null;
    } catch { return null; }
  };

  const [balData, invData, pnlData, billData, vendorData, purchaseData, customerData] = await Promise.all([
    fetchOne("/api/ops/plaid/balance"),
    fetchOne("/api/ops/qbo/query?type=invoices"),
    fetchOne("/api/ops/qbo/query?type=pnl"),
    fetchOne("/api/ops/qbo/query?type=bills"),
    fetchOne("/api/ops/qbo/query?type=vendors"),
    fetchOne("/api/ops/qbo/query?type=purchases&limit=15"),
    fetchOne("/api/ops/qbo/query?type=customers"),
  ]);

  const parts: string[] = ["LIVE VERIFIED DATA (queried right now):"];

  if (balData?.accounts) {
    const accts = balData.accounts as Array<Record<string, unknown>>;
    for (const a of accts) {
      const b = a.balances as Record<string, unknown> | undefined;
      parts.push(`Bank: ${a.name} — $${b?.current ?? b?.available ?? 0} [source: Plaid live]`);
    }
  }

  if (invData?.invoices) {
    const invs = invData.invoices as Array<Record<string, unknown>>;
    const drafts = invs.filter((i) => i.Status === "draft");
    const sent = invs.filter((i) => i.Status === "outstanding");
    const paid = invs.filter((i) => i.Status === "paid");
    if (sent.length) parts.push(`AR (sent invoices): ${sent.map((i) => `${i.Customer} #${i.DocNumber} $${i.Balance}`).join(", ")} [source: QBO]`);
    if (drafts.length) parts.push(`Draft invoices (NOT AR — not sent yet): ${drafts.map((i) => `${i.Customer} #${i.DocNumber} $${i.Balance}`).join(", ")} [source: QBO]`);
    if (paid.length) parts.push(`Paid invoices: ${paid.length} collected [source: QBO]`);
    if (!sent.length && !drafts.length) parts.push("No invoices in QBO [source: QBO]");
  }

  if (pnlData?.summary) parts.push(`P&L MTD: ${JSON.stringify(pnlData.summary)} [source: QBO]`);

  if (billData?.bills) {
    const bills = billData.bills as Array<Record<string, unknown>>;
    const open = bills.filter((b) => Number(b.Balance || 0) > 0);
    if (open.length) parts.push(`AP (open bills): ${open.map((b) => `${b.Vendor} $${b.Balance}`).join(", ")} [source: QBO]`);
    else parts.push("AP: nothing due [source: QBO]");
  }

  if (vendorData?.vendors) {
    const vendors = vendorData.vendors as Array<Record<string, unknown>>;
    const active = vendors.filter((v) => v.Active !== false);
    if (active.length) parts.push(`Vendors (${active.length} active): ${active.slice(0, 20).map((v) => `${v.Name}${v.Email ? ` (${v.Email})` : ""}`).join(", ")} [source: QBO]`);
  }

  if (purchaseData?.purchases) {
    const purchases = purchaseData.purchases as Array<Record<string, unknown>>;
    if (purchases.length) parts.push(`Recent purchases (${purchases.length}): ${purchases.slice(0, 5).map((p) => `${p.Date} ${p.Vendor || "Unknown"} $${p.Amount}`).join("; ")} [source: QBO]`);
  }

  if (customerData?.customers) {
    const customers = customerData.customers as Array<Record<string, unknown>>;
    if (customers.length) parts.push(`Customers (${customers.length}): ${customers.map((c) => c.Name).join(", ")} [source: QBO]`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// System Prompt Builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(channel: string, displayName: string, liveData: string): string {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const channelName = CHANNEL_NAMES[channel] || channel;
  const isReceipts = channel === RECEIPTS_CHANNEL_ID;
  const receiptInstruction = isReceipts ? "\n\nThis message is in #receipts-capture. Every image here is a receipt. OCR it and extract: vendor name, date, amount, payment method, and likely expense category. Present a structured summary." : "";

  return `${BUSINESS_BRAIN}\n\n${CAPABILITY_BOUNDARIES}\n\nToday is ${today}.\nChannel: ${channelName}\nUser: ${displayName}${receiptInstruction}\n\n${liveData}`;
}

// ---------------------------------------------------------------------------
// Abra mention stripper
// ---------------------------------------------------------------------------

function stripAbraMention(text: string): string {
  return text.replace(/<@U0AKMSTL0GL>\s*/g, "").trim();
}

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json({ error: "No signing secret" }, { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as SlackEventBody;

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge || "" });
  }

  const event = body.event;
  if (!event || !["message", "app_mention"].includes(event.type || "")) {
    return NextResponse.json({ ok: true });
  }

  const { text, user, channel, ts, thread_ts, bot_id, subtype, files } = event;
  if (bot_id || subtype === "bot_message") return NextResponse.json({ ok: true });
  const hasText = Boolean(text?.trim());
  const hasFiles = Array.isArray(files) && files.length > 0;
  if ((!hasText && !hasFiles) || !user || !channel || !ts) return NextResponse.json({ ok: true });

  const isRetry = Boolean(req.headers.get("x-slack-retry-num"));

  // ACK immediately — all processing in after()
  after(async () => {
    if (isRetry) return;
    if (!(await shouldProcessSlackEvent({ eventId: body.event_id || null, channel, user, messageTs: ts, rootThreadTs: thread_ts || ts, text: text || "" }))) return;

    try {
      const rootThreadTs = thread_ts || ts;

      // Parallel fetches: display name, thread history, live data, images, file context
      const [displayName, history, liveData, images, fileContext] = await Promise.all([
        getSlackDisplayName(user),
        thread_ts ? getThreadHistory(channel, thread_ts) : getRecentChannelContext(channel, ts),
        fetchAllLiveData(),
        hasFiles ? Promise.all((files || []).filter(isImageFile).slice(0, 1).map(downloadSlackImage)) : Promise.resolve([]),
        hasFiles ? extractFileContext(files || []) : Promise.resolve(""),
      ]);

      if (!(await shouldClaimSlackMessageReply({ channel, rootThreadTs, user, messageTs: ts }))) return;

      const uploadedImages = images.filter((v): v is { name: string; mimeType: string; buffer: Buffer } => Boolean(v));

      // Build message text
      const explicitText = stripAbraMention(text?.trim() || "");
      const isReceiptsChannel = channel === RECEIPTS_CHANNEL_ID;
      const inferredPrompt = !explicitText && uploadedImages.length > 0
        ? isReceiptsChannel
          ? "A receipt image was uploaded. OCR this image and extract: vendor name, date, amount, payment method, and likely expense category."
          : "Analyze the attached image."
        : "";
      const messageText = [explicitText || inferredPrompt, fileContext ? `\n\n[ATTACHED FILES]\n${fileContext}` : ""].filter(Boolean).join("");

      // Build system prompt with full brain + live data
      const systemPrompt = buildSystemPrompt(channel, displayName, liveData);

      // Build messages array with thread history
      const historyMsgs = history.slice(-10).map((h) => ({ role: h.role as "user" | "assistant", content: h.content }));

      // Build user content (text + optional image)
      const userContent: Array<{ type: string; [key: string]: unknown }> = [];
      if (uploadedImages.length > 0) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: uploadedImages[0].mimeType, data: uploadedImages[0].buffer.toString("base64") },
        });
      }
      userContent.push({ type: "text", text: messageText || "(file attachment)" });

      // Call Claude API
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new Error("No ANTHROPIC_API_KEY");

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          max_tokens: 1500,
          temperature: 0.2,
          system: systemPrompt,
          messages: [...historyMsgs, { role: "user", content: userContent }],
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!res.ok) throw new Error(`Claude API ${res.status}`);

      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
      const reply = data.content?.filter((b) => b.type === "text").map((b) => b.text || "").join("\n").trim();

      if (reply) {
        await postSlackMessage(channel, reply, { threadTs: rootThreadTs });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("[slack/events] processing failed:", msg);
      await postSlackMessage(channel!, `I hit an error on this one — ${msg}. Let me know if you want me to retry.`, { threadTs: thread_ts || ts! }).catch(() => {});
    }
  });

  return NextResponse.json({ ok: true });
}
