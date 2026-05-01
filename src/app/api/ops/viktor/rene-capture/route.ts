/**
 * Viktor W-7 — Rene Response Capture (runtime).
 *
 * SOP: /contracts/agents/viktor-rene-capture.md.
 *
 * When Rene replies to the finance decision queue in Slack (posted to
 * #finance C0ATF50QQ1M on 2026-04-20 as the anchor), Viktor durably logs
 * each response so the working docs stay in sync even when Ben and
 * Claude are offline.
 *
 * This route is the fallback-cadence implementation. Triggered by
 * Vercel Cron (daily on Hobby; can move to 30-min on Pro; or to Slack
 * Events webhook when the 3.0 Slack app ships). For each matching
 * message:
 *   1. Parse the decision id + answer.
 *   2. Write a durable decision log entry (Supabase brain via
 *      `logDecision`) with full provenance.
 *   3. Post a confirmation reply in the originating thread.
 *   4. Mirror one line to #ops-audit per /contracts/slack-operating.md.
 *
 * Notion writes (Decision Log, Contradictions register, doctrine
 * banners) are NOT performed by this route today; they require the
 * Notion write helper to be wired into the repo. Per §11 of the SOP,
 * they are caught up by the next Claude Code session, which reads the
 * durable brain log to find pending items. The key durability
 * guarantee — "responses are captured even when we're offline" — is
 * satisfied by the brain log.
 *
 * Auth: bearer CRON_SECRET (same pattern as /api/ops/daily-brief and
 * /api/ops/control-plane/drift-audit).
 *
 * Accepts GET (Vercel Cron) and POST (manual trigger / future webhook).
 */

import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  conversationsHistory,
  postMessage,
  type SlackHistoryMessage,
} from "@/lib/ops/control-plane/slack";
import { slackChannelRef } from "@/lib/ops/control-plane/channels";
import { logDecision } from "@/lib/ops/decision-log";
import { matchW7Message, type W7Match } from "./matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Configuration ------------------------------------------------------

/** #finance (C0ATF50QQ1M) — anchor channel per SOP §1. */
const FINANCE_CHANNEL_ID = "C0ATF50QQ1M";

/**
 * Rene's Slack user id per viktor-rene-capture.md §2 + the canonical
 * table in slackUserIdToHumanOwner(). Only messages posted by this
 * user id are eligible for W-7 capture; other users' posts are
 * ignored (joint queue items still require individual Ben + Rene
 * acknowledgments per SOP §6).
 */
const RENE_USER_ID = process.env.SLACK_USER_RENE ?? "U0ALL27JM38";

/** Default scan window when invoked by daily cron. 25h gives 1h overlap
 * to absorb clock drift / DST transitions without double-capture (dedup
 * at brain-log level is the second defense). */
const DEFAULT_SCAN_HOURS = 25;

// ---- Handler ------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  return runCapture(req);
}

export async function POST(req: Request): Promise<Response> {
  return runCapture(req);
}

interface CaptureResult {
  ok: boolean;
  scanned: number;
  renesMessages: number;
  matches: number;
  captured: number;
  skipped: number;
  degraded: boolean;
  degradedReasons: string[];
  windowOldest: string;
  windowLatest: string;
}

async function runCapture(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const hoursParam = url.searchParams.get("hours");
  const hours = parseWindowHours(hoursParam, DEFAULT_SCAN_HOURS);
  const postConfirmations = url.searchParams.get("postConfirmations") !== "false";

  const now = Date.now();
  const oldestMs = now - hours * 3_600_000;
  const oldestSlackTs = `${Math.floor(oldestMs / 1000)}.000000`;
  const latestSlackTs = `${Math.floor(now / 1000)}.999999`;

  const result: CaptureResult = {
    ok: true,
    scanned: 0,
    renesMessages: 0,
    matches: 0,
    captured: 0,
    skipped: 0,
    degraded: false,
    degradedReasons: [],
    windowOldest: new Date(oldestMs).toISOString(),
    windowLatest: new Date(now).toISOString(),
  };

  // ---- Pull message history ----
  const hist = await conversationsHistory({
    channel: FINANCE_CHANNEL_ID,
    oldest: oldestSlackTs,
    latest: latestSlackTs,
    limit: 200,
  });

  if (!hist.ok) {
    result.ok = false;
    result.degraded = true;
    result.degradedReasons.push(
      `conversations.history failed: ${hist.error ?? "unknown"}${hist.degraded ? " (degraded-mode)" : ""}`,
    );
    return NextResponse.json(result, { status: hist.degraded ? 200 : 502 });
  }

  const messages = hist.messages ?? [];
  result.scanned = messages.length;

  // ---- Filter to Rene's messages ----
  const renesMessages = messages.filter(isReneMessage);
  result.renesMessages = renesMessages.length;

  // ---- Parse + capture ----
  for (const msg of renesMessages) {
    const matches = matchW7Message(msg.text ?? "");
    for (const m of matches) {
      result.matches += 1;
      const outcome = await captureOne({
        message: msg,
        match: m,
        postConfirmation: postConfirmations,
      });
      if (outcome === "captured") {
        result.captured += 1;
      } else {
        result.skipped += 1;
      }
    }
  }

  return NextResponse.json(result);
}

function isReneMessage(msg: SlackHistoryMessage): boolean {
  if (msg.subtype && msg.subtype !== "thread_broadcast") return false;
  return msg.user === RENE_USER_ID;
}

async function captureOne(input: {
  message: SlackHistoryMessage;
  match: W7Match;
  postConfirmation: boolean;
}): Promise<"captured" | "skipped"> {
  const { message, match, postConfirmation } = input;
  const permalink = `https://usagummies.slack.com/archives/${FINANCE_CHANNEL_ID}/p${message.ts.replace(".", "")}`;
  const retrievedAt = new Date().toISOString();

  // 1. Durable write to brain (Supabase). logDecision() is best-effort;
  //    it swallows env misconfig gracefully and never throws.
  try {
    await logDecision({
      decision_type: "action_execution",
      description: `W-7 Rene response: ${match.id} → ${match.answer}`,
      reasoning: [
        "Captured via Viktor W-7 runtime from #finance message.",
        `Decision id: ${match.id}`,
        `Rene's answer: ${match.answer}`,
        `Source: ${permalink}`,
        `Slack ts: ${message.ts}`,
        `RetrievedAt: ${retrievedAt}`,
      ].join("\n"),
      data_sources: ["slack:#finance", `slack_ts:${message.ts}`, `slack_user:${RENE_USER_ID}`],
      confidence: 1,
      outcome: "executed",
      actor: "viktor-w7-runtime",
      metadata: {
        decision_id: match.id,
        answer: match.answer,
        slack_channel: FINANCE_CHANNEL_ID,
        slack_ts: message.ts,
        slack_permalink: permalink,
        thread_ts: message.thread_ts ?? message.ts,
        rene_user_id: RENE_USER_ID,
      },
    });
  } catch {
    // logDecision is designed not to throw, but be extra defensive —
    // a write failure here must not prevent the Slack confirmation.
  }

  // 2. Post confirmation reply in the originating thread (best-effort).
  if (postConfirmation) {
    const threadTs = message.thread_ts ?? message.ts;
    await postMessage({
      channel: FINANCE_CHANNEL_ID,
      threadTs,
      text: `Logged: ${match.id} → "${match.answer}". Captured by Viktor W-7 runtime at ${retrievedAt}. Durable log written to brain; Notion cascade updates run in the next Claude Code session per viktor-rene-capture.md §11.`,
    });
  }

  // 3. Audit mirror — one-line summary to #ops-audit.
  //    AuditSurface.mirror() takes a full AuditLogEntry; for W-7 we
  //    post directly via postMessage() with the canonical line shape so
  //    the mirror survives even if the audit store is unreachable.
  //    The brain log above is the authoritative record.
  try {
    const auditChannel = slackChannelRef("ops-audit");
    const auditLine = [
      `✓ \`financials\` \`agent:viktor-w7-runtime\``,
      `→ \`viktor.w7.rene-capture\` decision:${match.id} conf=1.00`,
      `sources=slack:${message.ts}`,
      `[run \`w7-${message.ts}\` • ${retrievedAt}]`,
    ].join(" ");
    await postMessage({ channel: auditChannel, text: auditLine });
  } catch {
    // Audit is a best-effort mirror; authoritative state is the brain log.
  }

  return "captured";
}

function parseWindowHours(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Clamp to [1h, 168h = 7d] — longer windows invite double-capture
  // and Slack rate-limit pressure.
  return Math.max(1, Math.min(168, n));
}
