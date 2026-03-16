#!/usr/bin/env node
/**
 * USA Gummies — Shared Utility Library
 *
 * Core infrastructure shared by ALL agentic engines:
 *   - B2B Sales Engine (usa-gummies-agentic.mjs)
 *   - Revenue Intelligence (usa-gummies-revenue-intel.mjs)
 *   - DTC Retention (usa-gummies-dtc-engine.mjs)
 *   - SEO Content (usa-gummies-seo-engine.mjs)
 *   - Supply Chain (usa-gummies-supply-chain.mjs)
 *   - Financial Operations (usa-gummies-finops.mjs)
 *
 * Usage:
 *   import { createEngine } from "./lib/usa-gummies-shared.mjs";
 *   const engine = createEngine({ name: "finops", ... });
 *   engine.log("Starting...");
 *   const rows = await engine.queryDatabaseAll(dbId);
 */

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

// ── Constants ────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || "/Users/ben";
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");
const CREDS_FILE = path.join(CONFIG_DIR, ".notion-credentials");
const FETCH_TIMEOUT_MS = 15000;
const NOTION_VERSION = "2022-06-28";
const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PHONE_NUMBERS = ["4358967765", "6102356973"];

/** Are we running on Vercel (cloud) or a local dev machine? */
function _isCloud() {
  return process.env.VERCEL === "1";
}

const PROJECT_ROOT = (() => {
  try {
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  } catch {
    return process.cwd();
  }
})();

const SEND_EMAIL_SCRIPT = path.join(PROJECT_ROOT, "scripts/send-email.sh");
const CHECK_EMAIL_SCRIPT = path.join(PROJECT_ROOT, "scripts/check-email.sh");

// ── Date & Time (Eastern Time) ──────────────────────────────────────────────

export function etParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour") || "0");
  const minute = Number(get("minute") || "0");
  const second = Number(get("second") || "0");
  const weekday = get("weekday");
  return {
    year, month, day, hour, minute, second, weekday,
    date: `${year}-${month}-${day}`,
    minutesOfDay: hour * 60 + minute,
  };
}

export function todayET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export function todayLongET() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export function nowETTimestamp() {
  const et = etParts(new Date());
  return `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`;
}

export function addDaysToDate(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const et = etParts(d);
  return et.date;
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const source = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = new Date(`${todayET()}T00:00:00Z`).getTime();
  return Math.floor((now - source) / (24 * 3600 * 1000));
}

// ── Logging ─────────────────────────────────────────────────────────────────

export function log(msg, prefix = "") {
  const ts = new Date().toISOString();
  const tag = prefix ? `[${prefix}] ` : "";
  console.log(`[${ts}] ${tag}${msg}`);
}

// ── Network ─────────────────────────────────────────────────────────────────

export async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function promiseWithTimeout(promise, timeoutMs, fallbackValue = null) {
  const timeout = Math.max(1000, Number(timeoutMs || 0));
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── JSON State Files ────────────────────────────────────────────────────────

export function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  // Fire-and-forget sync to Vercel KV (cloud mirror)
  _syncToKV(filePath, value);
}

// ── KV Cloud Sync (fire-and-forget) ──────────────────────────────────────────
// Maps local file paths to KV keys so the Vercel dashboard can read engine state.
// Requires KV_REST_API_URL + KV_REST_API_TOKEN in env (from .env-daily-report).

const _KV_FILE_TO_KEY = {
  "agentic-system-status.json": "usag:system-status",
  "agentic-run-ledger.json": "usag:run-ledger",
  "reply-attention-queue.json": "usag:reply-queue",
  "reply-approved-sends.json": "usag:approved-sends",
  "agentic-kpi-tuning.json": "usag:kpi-tuning",
  "agentic-deliverability-guard.json": "usag:deliverability-guard",
  "agentic-send-reconcile.json": "usag:send-reconcile",
  "agentic-inbox-processed.json": "usag:inbox-processed",
  "agentic-inbox-backfill-processed.json": "usag:inbox-backfill-processed",
  "agentic-template-performance.json": "usag:template-performance",
  "agentic-quotes-pending.json": "usag:quotes-pending",
  "agentic-reengagement-log.json": "usag:reengagement-log",
  "agentic-faire-orders.json": "usag:faire-orders",
  "agentic-self-heal.lock": "usag:self-heal-lock",
  "processed-emails.json": "usag:processed-emails",
  "inbox-responder-log.json": "usag:inbox-responder-log",
  "finops-transaction-cache.json": "usag:finops-transaction-cache",
  "finops-invoice-cache.json": "usag:finops-invoice-cache",
  "finops-reconciliation-state.json": "usag:finops-reconciliation-state",
};

function _syncToKV(filePath, value) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return; // KV not configured — skip silently

  const fileName = path.basename(filePath);
  const kvKey = _KV_FILE_TO_KEY[fileName];
  if (!kvKey) return; // Not a synced file

  // Upstash Redis REST API: POST ["SET", key, value]
  const body = JSON.stringify(["SET", kvKey, JSON.stringify(value)]);
  fetch(kvUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Silently ignore KV sync failures — local file is the source of truth
  });
}

/** Sync a text file (log, pid) to KV as the last N lines */
export function syncTextToKV(filePath, maxLines = 200) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return;

  const fileNameToKey = {
    "agentic-engine.log": "usag:engine-log",
    "command-center.log": "usag:command-center-log",
    "command-center.pid": "usag:command-center-pid",
  };
  const fileName = path.basename(filePath);
  const kvKey = fileNameToKey[fileName];
  if (!kvKey) return;

  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-maxLines);
    const body = JSON.stringify(["SET", kvKey, JSON.stringify(lines)]);
    fetch(kvUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch {
    // Silently ignore
  }
}

// ── Notion API ──────────────────────────────────────────────────────────────

let _notionKey = "";
const _dbSchemas = {};

export function readNotionKey() {
  if (_notionKey) return _notionKey;
  if (!fs.existsSync(CREDS_FILE)) {
    throw new Error(`Notion credentials file not found: ${CREDS_FILE}`);
  }
  const raw = fs.readFileSync(CREDS_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t.startsWith("NOTION_API_KEY=")) {
      _notionKey = t.slice("NOTION_API_KEY=".length).trim();
      break;
    }
  }
  if (!_notionKey) throw new Error("NOTION_API_KEY missing from .notion-credentials");
  return _notionKey;
}

export function getNotionKey() {
  return _notionKey;
}

export function getDbSchemas() {
  return _dbSchemas;
}

export function toNotionId(id) {
  return (id || "").replace(/-/g, "");
}

export async function notion(pathname, method = "GET", body = null) {
  const key = readNotionKey();
  const res = await fetchWithTimeout(
    `https://api.notion.com/v1${pathname}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    20000
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

// ── Notion Property Helpers ─────────────────────────────────────────────────

export function richTextValue(text) {
  if (!text) return [];
  return [{ type: "text", text: { content: String(text).slice(0, 2000) } }];
}

export function blockParagraph(text) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richTextValue(text) } };
}

export function blockHeading(text) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richTextValue(text) } };
}

export function stripEmojiPrefix(title) {
  return String(title || "").replace(/^[^A-Za-z0-9\[]+/, "").trim();
}

export function getPlainText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x) => x.plain_text || "").join("");
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  if (prop.type === "number") return prop.number != null ? String(prop.number) : "";
  if (prop.type === "multi_select") return (prop.multi_select || []).map((x) => x.name).join(", ");
  if (prop.type === "relation") return (prop.relation || []).map((x) => x.id).join(", ");
  return "";
}

export function getPropByName(page, ...names) {
  for (const name of names) {
    if (page.properties?.[name]) return page.properties[name];
  }
  return null;
}

export function getFirstName(fullName) {
  const cleaned = String(fullName || "").trim();
  if (!cleaned) return "there";
  return cleaned.split(/\s+/)[0];
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function extractFirstEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeEmail(match?.[0] || "");
}

// ── Notion CRUD ─────────────────────────────────────────────────────────────

export async function getDatabase(dbId) {
  return notion(`/databases/${toNotionId(dbId)}`);
}

export async function queryDatabaseAll(dbId, filter = null, sorts = null) {
  const out = [];
  let startCursor = null;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const res = await notion(`/databases/${toNotionId(dbId)}/query`, "POST", body);
    out.push(...(res.results || []));
    startCursor = res.has_more ? res.next_cursor : null;
  } while (startCursor);
  return out;
}

export async function getPage(pageId) {
  return notion(`/pages/${toNotionId(pageId)}`);
}

export async function updatePage(pageId, properties) {
  return notion(`/pages/${toNotionId(pageId)}`, "PATCH", { properties });
}

export async function createPageInDb(dbId, properties, children = []) {
  return notion("/pages", "POST", {
    parent: { database_id: toNotionId(dbId) },
    properties,
    children,
  });
}

export async function appendChildren(blockId, children) {
  for (let i = 0; i < children.length; i += 100) {
    await notion(`/blocks/${toNotionId(blockId)}/children`, "PATCH", {
      children: children.slice(i, i + 100),
    });
  }
}

export async function listBlockChildren(blockId) {
  const out = [];
  let cursor = null;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const res = await notion(`/blocks/${toNotionId(blockId)}/children${qs}`);
    out.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

export async function ensureFields(dbId, requiredFields) {
  const db = await getDatabase(dbId);
  const current = db.properties || {};
  const patch = {};
  for (const [name, def] of Object.entries(requiredFields)) {
    if (!current[name]) patch[name] = def;
  }
  if (Object.keys(patch).length > 0) {
    await notion(`/databases/${toNotionId(dbId)}`, "PATCH", { properties: patch });
  }
  const refreshed = await getDatabase(dbId);
  _dbSchemas[dbId] = Object.fromEntries(
    Object.entries(refreshed.properties || {}).map(([k, v]) => [k, v.type])
  );
  return Object.keys(patch);
}

export function encodeProperty(type, value) {
  if (value === undefined) return undefined;
  if (type === "title") return { title: richTextValue(value) };
  if (type === "rich_text") return { rich_text: richTextValue(value) };
  if (type === "email") return { email: value ? String(value) : null };
  if (type === "phone_number") return { phone_number: value ? String(value) : null };
  if (type === "url") return { url: value ? String(value) : null };
  if (type === "number")
    return { number: value === null || value === "" || Number.isNaN(Number(value)) ? null : Number(value) };
  if (type === "date") return { date: value ? { start: String(value) } : null };
  if (type === "checkbox") return { checkbox: Boolean(value) };
  if (type === "select") return { select: value ? { name: String(value) } : null };
  if (type === "multi_select") {
    const arr = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
    return { multi_select: arr.map((name) => ({ name })) };
  }
  if (type === "relation") {
    const arr = Array.isArray(value) ? value : [value].filter(Boolean);
    return { relation: arr.map((id) => ({ id: toNotionId(id) })) };
  }
  return undefined;
}

export function buildProperties(dbId, values) {
  const schema = _dbSchemas[dbId] || {};
  const props = {};
  for (const [key, value] of Object.entries(values)) {
    if (!schema[key]) continue;
    const encoded = encodeProperty(schema[key], value);
    if (encoded !== undefined) props[key] = encoded;
  }
  return props;
}

// ── Email ────────────────────────────────────────────────────────────────────
// Cloud: nodemailer (SMTP)  |  Local: himalaya CLI (bash scripts)

let _nodemailer = null;

async function _getNodemailerTransport() {
  if (_nodemailer) return _nodemailer;
  const nm = await import("nodemailer");
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
  const user = process.env.SMTP_USER || "ben@usagummies.com";
  if (!pass) throw new Error("No GMAIL_APP_PASSWORD or SMTP_PASS env var");
  _nodemailer = nm.default.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user, pass },
  });
  return _nodemailer;
}

export function sendEmail({ to, subject, body, dryRun }) {
  if (_isCloud()) {
    // Cloud path: use nodemailer (async, returns promise-like result)
    return _sendEmailCloud({ to, subject, body, dryRun });
  }
  // Local path: himalaya CLI
  const args = [SEND_EMAIL_SCRIPT, "--to", to, "--subject", subject, "--body", body];
  if (dryRun) args.push("--dry-run");
  const res = spawnSync("bash", args, { encoding: "utf8" });
  return {
    ok: res.status === 0,
    output: `${res.stdout || ""}${res.stderr || ""}`.trim(),
  };
}

async function _sendEmailCloud({ to, subject, body, dryRun }) {
  if (dryRun) return { ok: true, output: `DRY RUN: Would send "${subject}" to ${to}` };
  try {
    const transport = await _getNodemailerTransport();
    await transport.sendMail({
      from: "Ben <ben@usagummies.com>",
      to,
      subject,
      text: body,
    });
    return { ok: true, output: `SENT: "${subject}" to ${to}` };
  } catch (err) {
    return { ok: false, output: `SEND_FAILED: ${err.message}` };
  }
}

export function checkEmail({ folder = "INBOX", count = 20, query = "" } = {}) {
  if (_isCloud()) {
    // On cloud, checkEmail is async — agents using this should await it
    return _checkEmailCloud({ folder, count, query });
  }
  // Local path: himalaya CLI
  const args = [CHECK_EMAIL_SCRIPT, "--folder", folder, "--count", String(count)];
  if (query) args.push("--query", query);
  const res = spawnSync("bash", args, { encoding: "utf8", timeout: 30000 });
  return {
    ok: res.status === 0,
    output: `${res.stdout || ""}`.trim(),
    error: `${res.stderr || ""}`.trim(),
  };
}

async function _checkEmailCloud({ folder, count, query }) {
  // Uses Gmail API via googleapis (already a dependency)
  try {
    const { google } = await import("googleapis");
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      return { ok: false, output: "", error: "Gmail OAuth not configured" };
    }
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    const parts = [];
    if (folder && folder !== "INBOX") parts.push(`in:${folder.toLowerCase()}`);
    if (query) parts.push(query);
    const q = parts.length > 0 ? parts.join(" ") : undefined;
    const labelIds = folder === "INBOX" ? ["INBOX"] : undefined;

    const listRes = await gmail.users.messages.list({
      userId: "me", maxResults: count, q, labelIds,
    });
    const messages = listRes.data.messages || [];
    const lines = [];
    for (const msg of messages.slice(0, count)) {
      if (!msg.id) continue;
      const detail = await gmail.users.messages.get({
        userId: "me", id: msg.id, format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers || [];
      const getH = (n) => (headers.find((h) => h.name?.toLowerCase() === n.toLowerCase()))?.value || "";
      lines.push(`${msg.id} | ${getH("From")} | ${getH("Subject")} | ${getH("Date")}`);
    }
    return { ok: true, output: lines.join("\n"), error: "" };
  } catch (err) {
    return { ok: false, output: "", error: `Gmail API error: ${err.message}` };
  }
}

export function renderTemplate(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`[${k}]`, v || "");
  }
  return out;
}

// ── Notifications (iMessage local / Slack cloud) ─────────────────────────────

export function sendIMessage(message) {
  if (_isCloud()) {
    return _sendSlackNotification("alerts", message);
  }
  const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  for (const phone of PHONE_NUMBERS) {
    const script = `
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "${phone}" of targetService
        send "${escaped}" to targetBuddy
      end tell
    `;
    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    } catch (err) {
      log(`iMessage send failed to ${phone}: ${err.message}`);
    }
  }
}

export function textBen(message) {
  return sendIMessage(message);
}

/** Send to Slack via incoming webhook (cloud-only) */
async function _sendSlackNotification(channel, text) {
  const webhookMap = {
    alerts: process.env.SLACK_WEBHOOK_ALERTS,
    pipeline: process.env.SLACK_WEBHOOK_PIPELINE,
    daily: process.env.SLACK_WEBHOOK_DAILY,
  };
  const url = webhookMap[channel];
  if (!url) {
    log(`[notify] No Slack webhook for channel: ${channel}`);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    log(`[notify] Slack send failed (${channel}): ${err.message}`);
  }
}

/** Send to a specific Slack channel from any engine */
export function notifySlack(channel, text) {
  return _sendSlackNotification(channel, text);
}

// ── Run Status Management ───────────────────────────────────────────────────

export function normalizeRunStatus(statusValue) {
  const raw = String(statusValue || "").trim().toLowerCase();
  if (raw === "partial") return "partial";
  if (raw === "failed" || raw === "failure" || raw === "error") return "failed";
  return "success";
}

// ── Engine Factory ──────────────────────────────────────────────────────────

/**
 * Creates a self-contained engine context for a specific system.
 *
 * @param {Object} config
 * @param {string} config.name - Engine name (e.g., "finops", "revenue-intel")
 * @param {Object} config.schedulePlan - Agent schedule definitions
 * @param {Object} config.ids - Notion database IDs used by this engine
 * @param {string} [config.statusFile] - Override status file path
 * @param {string} [config.runLedgerFile] - Override run ledger file path
 * @param {string} [config.logPrefix] - Log prefix (defaults to engine name)
 */
export function createEngine(config) {
  const {
    name,
    schedulePlan = {},
    ids = {},
    statusFile = path.join(CONFIG_DIR, `${name}-status.json`),
    runLedgerFile = path.join(CONFIG_DIR, `${name}-run-ledger.json`),
    lockFile = path.join(CONFIG_DIR, `${name}-self-heal.lock`),
    logPrefix = name,
  } = config;

  // ── Engine-scoped logging ──

  function engineLog(msg) {
    log(msg, logPrefix);
  }

  // ── Engine-scoped status management ──

  function defaultStatusModel() {
    const seededAgents = Object.fromEntries(
      Object.entries(schedulePlan).map(([key, schedule]) => [
        key,
        { key, label: schedule.label, lastStatus: "never" },
      ])
    );
    return {
      engine: name,
      timezone: "America/New_York",
      updatedAt: new Date().toISOString(),
      updatedAtET: `${todayET()} 00:00:00`,
      heartbeat: { lastSeenAt: new Date().toISOString(), source: "bootstrap" },
      schedule: schedulePlan,
      agents: seededAgents,
      recentEvents: [],
      selfHeal: { lastRunAt: "", lastActionSummary: "", actions: [] },
    };
  }

  function loadSystemStatus() {
    try {
      if (!fs.existsSync(statusFile)) return defaultStatusModel();
      const raw = fs.readFileSync(statusFile, "utf8");
      const parsed = JSON.parse(raw);
      const base = defaultStatusModel();
      return {
        ...base,
        ...parsed,
        schedule: schedulePlan,
        agents: { ...(base.agents || {}), ...(parsed?.agents || {}) },
        recentEvents: Array.isArray(parsed?.recentEvents) ? parsed.recentEvents : [],
        selfHeal: { ...base.selfHeal, ...(parsed?.selfHeal || {}) },
      };
    } catch {
      return defaultStatusModel();
    }
  }

  function saveSystemStatus(status) {
    const now = new Date();
    const et = etParts(now);
    const next = {
      ...status,
      updatedAt: now.toISOString(),
      updatedAtET: `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`,
      heartbeat: {
        ...(status.heartbeat || {}),
        lastSeenAt: now.toISOString(),
        source: status?.heartbeat?.source || "agent-runtime",
      },
      schedule: schedulePlan,
    };
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify(next, null, 2), "utf8");
  }

  function appendStatusEvent(status, event) {
    const events = Array.isArray(status.recentEvents) ? status.recentEvents : [];
    events.push(event);
    status.recentEvents = events.slice(-80);
  }

  function updateAgentStatus(agentKey, payload) {
    const status = loadSystemStatus();
    const now = new Date();
    const et = etParts(now);
    const existing = status.agents?.[agentKey] || {};
    status.agents = status.agents || {};
    status.agents[agentKey] = {
      ...existing,
      key: agentKey,
      label: schedulePlan[agentKey]?.label || existing.label || agentKey,
      lastRunAt: now.toISOString(),
      lastRunAtET: `${et.date} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:${String(et.second).padStart(2, "0")}`,
      lastRunDateET: et.date,
      ...payload,
    };
    appendStatusEvent(status, {
      at: now.toISOString(),
      agent: agentKey,
      status: payload.lastStatus || "unknown",
      summary: payload.summary || "",
    });
    saveSystemStatus(status);
  }

  // ── Engine-scoped run ledger ──

  function loadRunLedger() {
    const value = safeJsonRead(runLedgerFile, []);
    return Array.isArray(value) ? value : [];
  }

  function appendRunLedger(entry) {
    const ledger = loadRunLedger();
    ledger.push(entry);
    safeJsonWrite(runLedgerFile, ledger.slice(-5000));
  }

  function sumAgentSendsForDate(agentKey, runDateET = todayET()) {
    return loadRunLedger()
      .filter(
        (x) =>
          x?.runDateET === runDateET &&
          x?.agent === agentKey &&
          (x?.status === "success" || x?.status === "partial")
      )
      .reduce((sum, x) => sum + Number(x?.result?.sent || 0), 0);
  }

  // ── Self-heal lock ──

  function tryAcquireSelfHealLock(maxAgeMs = 45 * 60 * 1000) {
    try {
      if (fs.existsSync(lockFile)) {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs < maxAgeMs) return false;
      }
      fs.mkdirSync(path.dirname(lockFile), { recursive: true });
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  function releaseSelfHealLock() {
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch { /* ignore */ }
  }

  // ── Agent monitoring wrapper ──

  function summarizeAgentResult(result) {
    if (!result) return "no_result";
    const parts = [];
    if (result.processed != null) parts.push(`processed=${result.processed}`);
    if (result.sent != null) parts.push(`sent=${result.sent}`);
    if (result.created != null) parts.push(`created=${result.created}`);
    if (result.updated != null) parts.push(`updated=${result.updated}`);
    if (result.matched != null) parts.push(`matched=${result.matched}`);
    if (result.flagged != null) parts.push(`flagged=${result.flagged}`);
    if (result.errors?.length) parts.push(`errors=${result.errors.length}`);
    if (result.failures?.length) parts.push(`failures=${result.failures.length}`);
    if (result.status) parts.push(`status=${result.status}`);
    if (result.notes) parts.push(result.notes);
    return parts.join(", ") || "ok";
  }

  async function runSingleAgentWithMonitoring(agentKey, handler, context = {}) {
    const startedAt = Date.now();
    updateAgentStatus(agentKey, {
      lastStatus: "running",
      source: context.source || "manual",
      summary: "run started",
    });
    try {
      const result = await handler();
      const durationMs = Date.now() - startedAt;
      const normalizedStatus = normalizeRunStatus(result?.status);
      const resultErrors = [
        ...(Array.isArray(result?.errors) ? result.errors : []),
        ...(Array.isArray(result?.failures) ? result.failures : []),
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      updateAgentStatus(agentKey, {
        lastStatus: normalizedStatus,
        lastDurationMs: durationMs,
        source: context.source || "manual",
        summary: summarizeAgentResult(result),
        lastError: normalizedStatus === "success" ? "" : resultErrors.slice(0, 3).join(" | "),
        lastResult: result,
      });
      appendRunLedger({
        runAt: new Date().toISOString(),
        runAtET: nowETTimestamp(),
        runDateET: todayET(),
        agent: agentKey,
        label: schedulePlan[agentKey]?.label || agentKey,
        source: context.source || "manual",
        status: normalizedStatus,
        durationMs,
        result,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = String(err?.message || err || "unknown_error");
      updateAgentStatus(agentKey, {
        lastStatus: "failed",
        lastDurationMs: durationMs,
        source: context.source || "manual",
        summary: `error=${message.slice(0, 160)}`,
        lastError: message,
      });
      appendRunLedger({
        runAt: new Date().toISOString(),
        runAtET: nowETTimestamp(),
        runDateET: todayET(),
        agent: agentKey,
        label: schedulePlan[agentKey]?.label || agentKey,
        source: context.source || "manual",
        status: "failed",
        durationMs,
        error: message,
      });
      throw err;
    }
  }

  // ── Notion Run Logging ──

  async function logRun({ agentName, recordsProcessed = 0, emailsSent = 0, errors = "", status = "Success", notes = "" }) {
    const runLogId = ids.runLog;
    if (!runLogId) {
      engineLog(`logRun skipped: no runLog DB ID configured`);
      return;
    }
    const runDate = todayET();
    const props = buildProperties(runLogId, {
      "Agent Name": agentName,
      "Run Date": runDate,
      "Records Processed": recordsProcessed,
      "Emails Sent": emailsSent,
      Errors: errors,
      Status: status,
      Notes: notes,
    });
    // fallback field name variations
    if (!props["Agent Name"] && _dbSchemas[runLogId]?.Name === "title") {
      props.Name = { title: richTextValue(agentName) };
    }
    if (!props["Run Date"] && _dbSchemas[runLogId]?.Timestamp === "date") {
      props.Timestamp = { date: { start: runDate } };
    }
    if (!props.Status && _dbSchemas[runLogId]?.Status === "select") {
      props.Status = { select: { name: status } };
    }
    if (!props.Notes && _dbSchemas[runLogId]?.Details === "rich_text") {
      props.Details = { rich_text: richTextValue(notes || errors || "") };
    }
    await createPageInDb(runLogId, props);
  }

  // ── Self-heal repair logic ──

  function shouldRepairAgentNow(agentKey, agentState, nowET) {
    const schedule = schedulePlan[agentKey];
    if (!schedule) return false;
    if (!agentState) return false;
    if (agentState.lastStatus === "running") return false;
    const lastRunMs = agentState.lastRunAt ? Date.parse(agentState.lastRunAt) : 0;
    const ageMin = lastRunMs ? (Date.now() - lastRunMs) / 60000 : Number.POSITIVE_INFINITY;

    if (schedule.intervalMinutes) {
      if (!lastRunMs) return true;
      return ageMin > (schedule.graceMinutes || schedule.intervalMinutes * 2);
    }

    const scheduledMinutes = schedule.hour * 60 + schedule.minute;
    const nowMinutes = nowET.minutesOfDay;
    const today = nowET.date;
    const hasRunToday = agentState.lastRunDateET === today;
    if (hasRunToday && agentState.lastStatus === "failed" && ageMin > 30) return true;
    if (!hasRunToday && nowMinutes > scheduledMinutes + (schedule.graceMinutes || 120)) return true;
    return false;
  }

  // ── CLI arg parser ──

  function parseArgs(argv) {
    const args = [...argv];
    const out = { cmd: args.shift() || "help" };
    while (args.length) {
      const a = args.shift();
      if (a === "--dry-run") out.dryRun = true;
      else if (a === "--backfill") out.backfill = true;
      else if (a === "--recovery") out.recovery = true;
      else if (a === "--limit") out.limit = Number(args.shift() || "0");
      else if (a === "--target") out.target = Number(args.shift() || "0");
      else if (a === "--count") out.count = Number(args.shift() || "0");
      else if (a === "--max-processed") out.maxProcessed = Number(args.shift() || "0");
      else if (a === "--source") out.source = String(args.shift() || "");
      else if (a === "--agent") out.agent = args.shift();
      else if (!out.arg) out.arg = a;
    }
    return out;
  }

  // Return the engine context
  return {
    name,
    ids,
    schedulePlan,
    statusFile,
    runLedgerFile,
    lockFile,

    // Logging
    log: engineLog,

    // Status
    loadSystemStatus,
    saveSystemStatus,
    updateAgentStatus,
    appendStatusEvent,

    // Run ledger
    loadRunLedger,
    appendRunLedger,
    sumAgentSendsForDate,

    // Self-heal
    tryAcquireSelfHealLock,
    releaseSelfHealLock,
    shouldRepairAgentNow,

    // Monitoring
    runSingleAgentWithMonitoring,
    summarizeAgentResult,

    // Notion run logging
    logRun,

    // CLI
    parseArgs,

    // Convenience helpers — used by SEO, DTC, Supply Chain, Social, Marketing engines
    succeed(agentKey, summary) {
      updateAgentStatus(agentKey, { lastStatus: "success", summary: JSON.stringify(summary) });
      engineLog(`${agentKey} — ✓ ${JSON.stringify(summary)}`);
      return { ok: true, ...summary };
    },
    fail(agentKey, error) {
      updateAgentStatus(agentKey, { lastStatus: "error", summary: String(error) });
      engineLog(`${agentKey} — ✗ ${error}`);
      return { ok: false, error: String(error) };
    },
  };
}

// ── GA4 Data API ────────────────────────────────────────────────────────────

const GA4_SERVICE_ACCOUNT_FILE = path.join(CONFIG_DIR, "ga4-service-account.json");
const GA4_PROPERTY_ID = "509104328";

export function loadGA4ServiceAccount() {
  if (!fs.existsSync(GA4_SERVICE_ACCOUNT_FILE)) {
    throw new Error(`GA4 service account file not found: ${GA4_SERVICE_ACCOUNT_FILE}`);
  }
  return JSON.parse(fs.readFileSync(GA4_SERVICE_ACCOUNT_FILE, "utf8"));
}

export { GA4_PROPERTY_ID, CONFIG_DIR, HOME, PROJECT_ROOT, HTTP_USER_AGENT, PHONE_NUMBERS };
