/**
 * Phase 3.3 — pure follow-up email template for the Faire Direct
 * follow-up close-loop. Subject + body only. No I/O.
 *
 * Locked rules (every one tested):
 *   - Includes retailerName, buyerName (when present), directLinkUrl.
 *   - NO medical / supplement / vitamin / immune / cure / treat / FDA
 *     / heal / health-benefit claims.
 *   - NO pricing / terms / lead-time / payment / commission / margin
 *     promises.
 *   - Closing carries operator-only contact (ben@usagummies.com).
 *     NO personal cell phone, NO recipient PII echo, NO HubSpot id
 *     leak.
 *   - Subject is the locked string FAIRE_FOLLOW_UP_SUBJECT.
 *
 * The follow-up is intentionally short — a one-paragraph nudge plus
 * the same Faire Direct link. The retailer already received the
 * initial invite; we don't repeat the value pitch.
 */
import type { FaireInviteRecord } from "./invites";

export const FAIRE_FOLLOW_UP_SUBJECT =
  "Quick check-in — USA Gummies on Faire Direct";

/**
 * Plain-text body for the follow-up. The directLinkUrl is the SAME
 * URL the original invite carried; the closer reloads the record and
 * re-classifies before sending, so a stale or missing link aborts the
 * send before this template is ever used.
 */
export function renderFaireFollowUpEmailBody(
  record: FaireInviteRecord,
): string {
  const greetingName =
    record.buyerName?.trim() && record.buyerName.trim().length > 0
      ? record.buyerName.trim()
      : record.retailerName.trim();

  const lines: string[] = [];
  lines.push(`Hi ${greetingName},`);
  lines.push("");
  lines.push(
    `Just a quick follow-up on the Faire Direct invite I sent over for ` +
      `${record.retailerName}. No worries if it slipped through — wanted ` +
      `to make sure the link reached you. Same invite below:`,
  );
  lines.push("");
  lines.push(record.directLinkUrl ?? "");
  lines.push("");
  lines.push(
    `Happy to walk you through Faire's checkout, returns, or any of the ` +
      `details if it's useful — just reply to this email and we can set ` +
      `up a quick call.`,
  );
  lines.push("");
  lines.push("Thanks again,");
  lines.push("Ben Stutman");
  lines.push("Founder, USA Gummies");
  lines.push("ben@usagummies.com");
  return lines.join("\n");
}
