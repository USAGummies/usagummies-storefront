/**
 * Cloud-compatible email sending via nodemailer (Gmail SMTP).
 *
 * Replaces scripts/send-email.sh (himalaya CLI) for Vercel-hosted agents.
 * Includes the same safety guards: recipient repeat guard, system-address
 * blocking, daily per-recipient caps.
 *
 * Usage:
 *   import { sendOpsEmail } from "@/lib/ops/email";
 *   const result = await sendOpsEmail({
 *     to: "partner@example.com",
 *     subject: "Follow-up",
 *     body: "Hi there...",
 *   });
 */

import nodemailer from "nodemailer";
import { readState, writeState } from "./state";
import type { StateKey } from "./state-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendEmailOpts = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  from?: string; // Defaults to "Ben <ben@usagummies.com>"
  dryRun?: boolean;
  allowRepeat?: boolean;
  allowSystemRecipient?: boolean;
};

export type SendEmailResult = {
  ok: boolean;
  message: string;
  blocked?: boolean;
  dryRun?: boolean;
};

type SendLogEntry = {
  timestamp: string;
  status: "SENT" | "FAILED" | "BLOCKED";
  to: string;
  subject: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SENDS_PER_RECIPIENT_PER_DAY = 1;

const SYSTEM_ADDRESS_PATTERNS = [
  /^(no-?reply|donotreply|postmaster|mailer-daemon|dmarc|bounce)@/i,
  /@(.*\.)?(teamwork|zendesk|freshdesk|helpdesk)\.com$/i,
];

// ---------------------------------------------------------------------------
// Transporter (lazy singleton)
// ---------------------------------------------------------------------------

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
    const user = process.env.SMTP_USER || "ben@usagummies.com";

    if (!pass) {
      throw new Error(
        "Email not configured: set GMAIL_APP_PASSWORD or SMTP_PASS env var"
      );
    }

    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || "587"),
      secure: false, // STARTTLS on 587
      auth: { user, pass },
    });
  }
  return _transporter;
}

// ---------------------------------------------------------------------------
// Send log (state-backed for cloud persistence)
// ---------------------------------------------------------------------------

const SEND_LOG_KEY: StateKey = "deliverability-guard";

type DeliverabilityState = {
  sendLog?: SendLogEntry[];
  dailyCounts?: Record<string, Record<string, number>>;
};

async function getSendLog(): Promise<DeliverabilityState> {
  return readState<DeliverabilityState>(SEND_LOG_KEY, {
    sendLog: [],
    dailyCounts: {},
  });
}

async function logSend(entry: SendLogEntry): Promise<void> {
  const state = await getSendLog();
  const log = state.sendLog ?? [];
  log.push(entry);
  // Keep last 2000 entries
  if (log.length > 2000) log.splice(0, log.length - 2000);

  // Update daily counts
  const today = etDate();
  const counts = state.dailyCounts ?? {};
  if (!counts[today]) counts[today] = {};
  const toLower = entry.to.toLowerCase();
  counts[today][toLower] = (counts[today][toLower] || 0) + 1;

  // Prune counts older than 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const dateKey of Object.keys(counts)) {
    if (dateKey < cutoffStr) delete counts[dateKey];
  }

  await writeState(SEND_LOG_KEY, { sendLog: log, dailyCounts: counts });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function etDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function etTimestamp(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(",", "");
}

// ---------------------------------------------------------------------------
// Main send function
// ---------------------------------------------------------------------------

export async function sendOpsEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const { to, subject, body, cc, dryRun, allowRepeat, allowSystemRecipient } = opts;
  const from = opts.from || "Ben <ben@usagummies.com>";
  const toLower = to.toLowerCase();

  // --- System address guard ---
  if (!allowSystemRecipient) {
    for (const pattern of SYSTEM_ADDRESS_PATTERNS) {
      if (pattern.test(toLower)) {
        await logSend({
          timestamp: etTimestamp(),
          status: "BLOCKED",
          to,
          subject,
          error: "system-address-guard",
        });
        return {
          ok: false,
          message: `BLOCKED: system/helpdesk recipient guard for ${to}`,
          blocked: true,
        };
      }
    }
  }

  // --- Repeat guard ---
  if (!allowRepeat) {
    const state = await getSendLog();
    const today = etDate();
    const counts = state.dailyCounts ?? {};
    const todayCounts = counts[today] ?? {};
    const sentToday = todayCounts[toLower] ?? 0;

    if (sentToday >= MAX_SENDS_PER_RECIPIENT_PER_DAY) {
      await logSend({
        timestamp: etTimestamp(),
        status: "BLOCKED",
        to,
        subject,
        error: `repeat-guard (sent ${sentToday} today, max=${MAX_SENDS_PER_RECIPIENT_PER_DAY})`,
      });
      return {
        ok: false,
        message: `BLOCKED: repeat guard for ${to} (sent ${sentToday} times today, max=${MAX_SENDS_PER_RECIPIENT_PER_DAY})`,
        blocked: true,
      };
    }
  }

  // --- Dry run ---
  if (dryRun) {
    return {
      ok: true,
      message: `DRY RUN: Would send "${subject}" to ${to}`,
      dryRun: true,
    };
  }

  // --- Send ---
  try {
    const transporter = getTransporter();
    const mailOpts: nodemailer.SendMailOptions = {
      from,
      to,
      subject,
      text: body,
    };
    if (cc) mailOpts.cc = cc;

    await transporter.sendMail(mailOpts);

    await logSend({
      timestamp: etTimestamp(),
      status: "SENT",
      to,
      subject,
    });

    return { ok: true, message: `SENT: "${subject}" to ${to}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await logSend({
      timestamp: etTimestamp(),
      status: "FAILED",
      to,
      subject,
      error: errorMsg,
    });

    return { ok: false, message: `FAILED: ${errorMsg}` };
  }
}
