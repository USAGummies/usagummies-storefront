/**
 * Twilio SMS sender for the Sales-Tour booth-visit field workflow (v0.2).
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §4 (output channel).
 *
 * Default behavior: send a tight summary of the booth quote to Ben's
 * personal cell so he can hand-show the buyer at the booth without
 * unlocking Slack and scrolling. Slack thread is still the audit truth;
 * SMS is just a glanceable companion.
 *
 * Auth env (all required for SMS to fire):
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_FROM_NUMBER  (Twilio-owned phone, E.164 format e.g. "+15551234567")
 *   - SALES_TOUR_BEN_SMS_TO  (Ben's cell, E.164 format)
 *
 * When any env is missing, `smsQuoteSummary` returns `{ ok: false,
 * skipped: true }` — fail-soft, never throws. The booth route swallows
 * this and posts to Slack only.
 */
import type { BoothQuote } from "./booth-visit-types";

export interface SmsResult {
  ok: boolean;
  /** True when SMS was skipped because Twilio env wasn't configured. */
  skipped?: boolean;
  /** Twilio message SID when ok=true. */
  messageSid?: string;
  /** Reason when ok=false. */
  error?: string;
  /** The actual SMS body that was sent (for audit + tests). */
  bodySent?: string;
}

/**
 * Compose the SMS body. Tight one-screen summary — under 320 chars
 * (2 SMS segments) when possible. Strips the long escalation clause +
 * approval-gate copy from the Slack reply since the buyer is standing
 * next to Ben and the audit trail is already in Slack.
 */
export function composeSmsBody(quote: BoothQuote): string {
  const prospect = quote.intent.prospectName ?? "(prospect)";
  const state = quote.intent.state ?? "?";
  const lines: string[] = [];
  lines.push(`${prospect} (${state}):`);
  for (const l of quote.lines) {
    // Strip Slack-specific markdown (`*`, backticks) + verbose suffix.
    const clean = l.label
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`/g, "")
      .replace(/\s*\*\([^)]+\)\*\s*$/, "")
      .replace(/\s+\*\(needs[^)]+\)\*$/, "")
      .trim();
    lines.push(`• ${clean}`);
  }
  if (quote.dealCheckRequired) {
    lines.push("⚠ Class C deal-check needed — confirm w/ Rene before promising.");
  }
  lines.push(`NCS: usagummies.com/upload/ncs`);
  lines.push(`Visit ${quote.visitId}`);
  return lines.join("\n");
}

/**
 * Send the booth-quote summary to Ben's cell via Twilio. Fail-soft on
 * any error path.
 */
export async function smsQuoteSummary(quote: BoothQuote): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const to = process.env.SALES_TOUR_BEN_SMS_TO?.trim();

  if (!sid || !token || !from || !to) {
    return {
      ok: false,
      skipped: true,
      error:
        "Twilio env not fully configured — skipping SMS (need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER + SALES_TOUR_BEN_SMS_TO)",
    };
  }

  const body = composeSmsBody(quote);
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: to, Body: body });

  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Twilio fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      bodySent: body,
    };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Twilio HTTP ${res.status}: ${errText.slice(0, 200)}`,
      bodySent: body,
    };
  }
  let data: { sid?: string };
  try {
    data = (await res.json()) as { sid?: string };
  } catch {
    // Some Twilio errors return non-JSON; we already know we got 2xx so
    // the message is sent — just don't have the SID.
    return { ok: true, bodySent: body };
  }
  return { ok: true, messageSid: data.sid, bodySent: body };
}
