/**
 * Sales-tour v0.3 — Twilio SMS to the BUYER with prefilled NCS-001 link.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §4 v0.3 plan.
 *
 * Companion to `sms-quote.ts` (which texts Ben). This one texts the
 * BUYER directly — short, one-line summary + a deep link to the
 * `/upload/ncs` form prefilled with company name + tour referral
 * code so the buyer can complete the vendor-onboarding form on their
 * phone before they leave the booth.
 *
 * Auth env (additive on top of v0.2):
 *   - TWILIO_ACCOUNT_SID  (existing)
 *   - TWILIO_AUTH_TOKEN   (existing)
 *   - TWILIO_FROM_NUMBER  (existing)
 *   - SALES_TOUR_BUYER_SMS_ENABLED  (NEW — must be "true" to actually send)
 *
 * **Why a separate enable flag from `SALES_TOUR_BEN_SMS_TO`:** texting
 * Ben is private. Texting a buyer is customer-facing — needs an
 * explicit opt-in flag so a misconfigured deploy can't accidentally
 * blast strangers. The flag must be set to "true" AND the booth
 * caller must include the buyer's phone in the intent.
 *
 * Fail-soft on every error path; never throws.
 */
import type { BoothQuote } from "./booth-visit-types";

const NCS_BASE_URL = "https://www.usagummies.com/upload/ncs";

export interface BuyerSmsResult {
  ok: boolean;
  /** True when SMS was skipped because env / opt-in flag missing. */
  skipped?: boolean;
  /** True when buyer phone wasn't captured at the booth. */
  missingBuyerPhone?: boolean;
  /** Twilio message SID when ok=true. */
  messageSid?: string;
  /** Reason when ok=false. */
  error?: string;
  /** The actual SMS body that was sent (for audit + tests). */
  bodySent?: string;
  /** The deep link emitted into the SMS (for audit + tests). */
  ncsDeepLink?: string;
}

/**
 * Build the prefilled `/upload/ncs?...` deep link for the buyer.
 *
 * Query params:
 *   • `co`  — buyer company name (URL-encoded)
 *   • `ref` — tour referral code (`{tourId}-{visitId}`) so the form
 *             submission can be cross-referenced back to the booth visit
 *
 * Pure: no I/O. Idempotent. Exported for reuse by the HubSpot
 * note-creator (v0.3 part 2) so the same deep link gets attached to
 * the deal record.
 */
export function buildNcsDeepLink(quote: BoothQuote): string {
  const co = quote.intent.prospectName ?? "";
  const ref = `${quote.tourId}-${quote.visitId}`;
  const params = new URLSearchParams();
  if (co) params.set("co", co);
  params.set("ref", ref);
  const qs = params.toString();
  return qs ? `${NCS_BASE_URL}?${qs}` : NCS_BASE_URL;
}

/**
 * Compose the buyer-facing SMS body. ONE message segment when
 * possible (≤160 chars). Tone: warm, professional, brand-voice
 * compliant — NEVER names Ben's full name or the warehouse city
 * per `/CLAUDE.md` §"Public-Facing Copy Rules".
 *
 * Pure formatter — no I/O.
 */
export function composeBuyerSmsBody(quote: BoothQuote): string {
  const link = buildNcsDeepLink(quote);
  const lines: string[] = [];
  lines.push(`USA Gummies — thanks for the chat.`);
  // One-line quote summary — no Slack markdown, no "Class C" copy.
  if (quote.lines.length > 0) {
    const first = quote.lines[0];
    const total = first.totalUsd > 0 ? ` ($${first.totalUsd.toFixed(0)})` : "";
    lines.push(`Quote: ${quote.intent.totalBags} bags @ $${first.pricePerBag.toFixed(2)}/bag${total}.`);
  }
  lines.push(`To get set up, fill out our vendor form: ${link}`);
  lines.push(`Reply STOP to opt out.`);
  return lines.join(" ");
}

/**
 * Send the booth-quote summary + NCS deeplink to the buyer's phone.
 * Fail-soft on every error path. Requires:
 *   - Twilio quartet env (sid, token, from)
 *   - SALES_TOUR_BUYER_SMS_ENABLED="true" (explicit opt-in)
 *   - quote.intent.contactPhone (captured at the booth)
 */
export async function smsBuyerNcsLink(quote: BoothQuote): Promise<BuyerSmsResult> {
  const enabled = process.env.SALES_TOUR_BUYER_SMS_ENABLED?.trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      error: "SALES_TOUR_BUYER_SMS_ENABLED is not 'true' — buyer SMS is opt-in to prevent accidental customer-facing sends",
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !from) {
    return {
      ok: false,
      skipped: true,
      error:
        "Twilio env not fully configured — need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER",
    };
  }

  const buyerPhone = quote.intent.contactPhone?.trim();
  if (!buyerPhone) {
    return {
      ok: false,
      missingBuyerPhone: true,
      error: "Booth intent did not capture buyer phone — cannot send SMS",
    };
  }

  // Twilio expects E.164. If the captured phone doesn't start with `+`,
  // assume US (+1) and strip non-digits.
  const cleaned = buyerPhone.replace(/[^\d+]/g, "");
  const e164 = cleaned.startsWith("+")
    ? cleaned
    : cleaned.length === 10
      ? `+1${cleaned}`
      : cleaned.length === 11 && cleaned.startsWith("1")
        ? `+${cleaned}`
        : null;
  if (!e164) {
    return {
      ok: false,
      error: `Buyer phone "${buyerPhone}" doesn't normalize to E.164 — refusing to send to potentially-malformed number`,
    };
  }

  const body = composeBuyerSmsBody(quote);
  const ncsDeepLink = buildNcsDeepLink(quote);
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: e164, Body: body });

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
      ncsDeepLink,
    };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Twilio HTTP ${res.status}: ${errText.slice(0, 200)}`,
      bodySent: body,
      ncsDeepLink,
    };
  }
  let data: { sid?: string };
  try {
    data = (await res.json()) as { sid?: string };
  } catch {
    return { ok: true, bodySent: body, ncsDeepLink };
  }
  return { ok: true, messageSid: data.sid, bodySent: body, ncsDeepLink };
}
