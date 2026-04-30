/**
 * Pure Slack-reply formatter — `BoothQuote` → Slack-ready text block.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §4 (output channel).
 *
 * Layout (locked v0.1):
 *   :dart: Booth quote — {prospectName} ({state})
 *   Class: {pricingClass} ({oneLineLabel})
 *   {line1}
 *   [{line2 if present}]
 *
 *   Freight: {freight summary}
 *   Lead time: {lead-time copy}
 *   Escalation: {clause}
 *
 *   {approval gate copy}
 *   NCS-001 vendor form: {url}
 *   Visit ID: {visitId}
 *
 * No I/O. No Slack-client deps. Returns a string ready for `chat.postMessage`.
 */
import type { ApprovalRequirement, BoothQuote, PricingClass } from "./booth-visit-types";

const NCS_FORM_URL = "https://www.usagummies.com/upload/ncs";

/** Human-readable one-line for the `Class:` row of the reply. */
function describeClass(pricingClass: PricingClass): string {
  switch (pricingClass) {
    case "C-PU":
      return "pickup floor — buyer arranges freight";
    case "C-DIST":
      return "distributor delivered";
    case "C-STD":
      return "standard wholesale (on-grid)";
    case "C-ANCH":
      return "landed route-anchor — 3-pallet minimum";
    case "C-FILL":
      return "route-fill — landed on planned route";
    case "C-EXC":
      return "strategic / sample exception";
  }
}

/** Approval-gate copy at the bottom of the reply. */
function approvalCopy(quote: BoothQuote): string {
  const reasons = quote.approvalReasons.length
    ? `_Reason: ${quote.approvalReasons.join("; ")}_`
    : "";
  switch (quote.approval) {
    case "none":
      return ":white_check_mark: Class A — quote is on the published B-grid; no approval needed. Confirm with buyer + collect NCS-001.";
    case "class-b":
      return `:large_yellow_circle: Class B (Ben single-approve) — \`account.tier-upgrade.propose\`. ${reasons}`;
    case "class-c":
      return `:rotating_light: Class C (Ben + Rene dual-approve) — \`pricing.change\`. Deal-check post will land in #wholesale shortly. ${reasons}`;
    case "class-d":
      return ":no_entry: Class D red-line — agent refuses. Manual handling only.";
  }
}

/** Format the buyer-contact block, omitting empty fields cleanly. */
function contactBlock(quote: BoothQuote): string {
  const parts: string[] = [];
  if (quote.intent.contactName) parts.push(quote.intent.contactName);
  if (quote.intent.contactPhone) parts.push(quote.intent.contactPhone);
  if (quote.intent.contactEmail) parts.push(quote.intent.contactEmail);
  if (parts.length === 0) return "";
  return `Contact: ${parts.join(" · ")}\n`;
}

/** Format the freight block based on the freight quote shape. */
function freightBlock(quote: BoothQuote): string {
  // No-freight-needed (sub-pallet).
  if (quote.freight.source === "no-freight-needed") {
    return "Freight: USPS / UPS rate at ship time (sub-pallet — auto-shipped from #shipping)\n";
  }
  // Off-corridor or unrecognized state.
  if (!quote.freight.found) {
    const stateLabel = quote.freight.state ?? "(state not captured)";
    return `Freight: ${stateLabel} is off the May-2026 corridor table — needs LTL bid before quoting landed (Ben should confirm pickup or get a live broker quote).\n`;
  }
  // Landed lines — show built-in cost.
  const hasLanded = quote.lines.some((l) => l.freightStance === "landed");
  const hasBuyerPaid = quote.lines.some((l) => l.freightStance === "buyer-paid");
  const lines: string[] = [];
  if (hasLanded) {
    lines.push(
      `Freight (landed lines): drive ~$${quote.freight.totalDrive?.toFixed(0)} total / ~$${quote.freight.drivePerPallet?.toFixed(0)}/pallet (founder-drive); LTL fallback ~$${quote.freight.totalLtl?.toFixed(0)} [source: regional-table-v0.1]`,
    );
  }
  if (hasBuyerPaid) {
    lines.push("Freight (buyer-paid lines): buyer's carrier or pickup at our WA warehouse; no freight on our P&L");
  }
  return lines.join("\n") + "\n";
}

/** Compose the full Slack reply text. */
export function formatBoothQuoteReply(quote: BoothQuote): string {
  const prospect = quote.intent.prospectName ?? "(prospect name not captured)";
  const state = quote.intent.state ?? "(state not captured)";
  const headline = `:dart: *Booth quote — ${prospect} (${state})*`;
  const classLine = `Class: \`${quote.lines[0].pricingClass}\` — ${describeClass(quote.lines[0].pricingClass)}`;
  const lineRows = quote.lines.map((l) => `• ${l.label}`).join("\n");

  const leadTime = quote.intent.scale === "pallet" ? "5–7 business days from PO" : "2–3 business days from PO";

  const sections: string[] = [
    headline,
    classLine,
    lineRows,
    "",
    freightBlock(quote).trimEnd(),
    `Lead time: ${leadTime}`,
    `Escalation: ${quote.escalationClause}`,
    "",
    contactBlock(quote).trimEnd(),
    approvalCopy(quote),
    `NCS-001 vendor form: ${NCS_FORM_URL}`,
    `Visit ID: \`${quote.visitId}\` · Tour: ${quote.tourId}`,
  ];

  if (quote.intent.notes) {
    sections.splice(sections.length - 1, 0, `Notes: ${quote.intent.notes}`);
  }

  return sections.filter((s) => s !== undefined).join("\n");
}

/** Convenience export — keep callers from importing the constant by typo. */
export const BOOTH_REPLY_NCS_URL = NCS_FORM_URL;
