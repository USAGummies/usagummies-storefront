/**
 * Wholesale AP onboarding packet email — body composer (Phase 35.f.3.c).
 *
 * Pure module that builds the email body sent to a new wholesale
 * customer alongside the canonical Rene-approved Apr 13 attachments
 * (NCS-001 v2 + CIF-001 + invoice draft + optional Welcome Packet).
 *
 * **Doctrinal anchors:**
 *   - Apr 13 working session (Rene + Viktor) locked the onboarding
 *     workflow + document set. This composer mirrors that workflow
 *     verbatim — the email's job is to introduce the existing
 *     attachments + restate Net 10 / Due on Receipt terms + provide
 *     the upload link for the returned NCS-001.
 *   - Apr 27 wholesale-pricing.md v1.0 — embeds the captured order
 *     in B-tier designator notation so the audit trail traces the
 *     price tier without ambiguity.
 *   - Apr 28 BCC-Rene-on-new-customer rule — composer expects the
 *     send pipeline to apply BCC: rene@usagummies.com (composer
 *     itself is pure; BCC is enforced in the dispatcher handler).
 *
 * **Pure** — no I/O, no Drive reads, no Gmail calls. Returns the
 * subject + text body. Caller composes the full SendGmailOpts.
 */
import type { OnboardingState } from "./onboarding-flow";
import { TIER_DISPLAY, TIER_INVOICE_LABEL } from "./pricing-tiers";
import { STANDARD_ESCALATION_CLAUSE } from "@/lib/finance/escalation-language";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApPacketEmailContext {
  /**
   * Optional invoice number to reference in the email body (e.g.
   * "Invoice #1755 attached"). Caller passes once the QBO draft is
   * created. If omitted, body says "your invoice draft is attached"
   * without the number.
   */
  invoiceNumber?: string;

  /**
   * Optional total dollar amount to restate in the email body.
   * Defaults to summing state.orderLines[].subtotalUsd. Caller can
   * override when there are non-line-item credits (e.g. "Reunion
   * 2026 show special — landed freight included" comp line).
   */
  totalUsdOverride?: number;

  /**
   * Optional one-line note to insert above the standard greeting —
   * useful for "Reunion show special" framing or "Per our call today"
   * personalization. Should be ≤ 80 chars.
   */
  personalNote?: string;

  /**
   * Net terms label to surface in the body. Defaults to
   * "Net 10 / Due on Receipt (see invoice)" — matches the Rene-
   * approved Apr 13 CIF-001 v3 lock.
   */
  netTermsLabel?: string;

  /**
   * URL to upload the completed NCS-001 form. Defaults to the
   * canonical /upload/ncs route. Override only for staging tests.
   */
  uploadNcsUrl?: string;

  /**
   * Display labels for the attachments included in the send. Drives
   * the "X documents attached:" enumeration. Keep order canonical:
   * NCS-001 first (it's the action item), CIF-001 second (reference),
   * invoice third (so AP team can pay), Welcome Packet last (orientation).
   */
  attachmentLabels: readonly string[];
}

export interface ApPacketEmailDraft {
  subject: string;
  body: string;
}

const DEFAULT_NET_TERMS = "Net 10 / Due on Receipt (see invoice)";
const DEFAULT_UPLOAD_URL = "https://www.usagummies.com/upload/ncs";
const SENDER_PHONE = "(307) 209-4928";
const SENDER_EMAIL = "ben@usagummies.com";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the wholesale-AP packet email. Pure.
 *
 * Throws if state.prospect is missing or the order has no line items
 * — the email's order-context block can't be honest without those.
 * Defensive: caller (the dispatcher handler) should validate up
 * front so this throw never trips in production.
 */
export function buildApPacketEmail(
  state: OnboardingState,
  ctx: ApPacketEmailContext,
): ApPacketEmailDraft {
  const p = state.prospect;
  if (!p) {
    throw new Error("buildApPacketEmail: state.prospect missing");
  }
  if (state.orderLines.length === 0) {
    throw new Error(
      "buildApPacketEmail: state.orderLines is empty — packet must reference a captured order",
    );
  }

  const greetingName = firstName(p.contactName);
  const subject = buildSubject(p.companyName, ctx.invoiceNumber);
  const body = buildBody(state, ctx, greetingName);

  return { subject, body };
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

function buildSubject(companyName: string, invoiceNumber?: string): string {
  // ASCII-only — locked by the Apr 27 spam-fix doctrine. No em-dash,
  // no curly quotes. encodeHeaderRfc2047 in gmail-reader.ts encodes
  // any non-ASCII defensively, but cleaner to ship clean.
  const inv = invoiceNumber ? ` (Invoice ${invoiceNumber})` : "";
  return `USA Gummies wholesale onboarding${inv} - ${companyName}`;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function buildBody(
  state: OnboardingState,
  ctx: ApPacketEmailContext,
  greetingName: string,
): string {
  const orderBlock = renderOrderBlock(state, ctx);
  const attachmentList = renderAttachmentList(ctx.attachmentLabels);
  const netTerms = ctx.netTermsLabel ?? DEFAULT_NET_TERMS;
  const uploadUrl = ctx.uploadNcsUrl ?? DEFAULT_UPLOAD_URL;

  const lines: string[] = [];

  if (ctx.personalNote) {
    lines.push(ctx.personalNote);
    lines.push("");
  }

  lines.push(`Hi ${greetingName},`);
  lines.push("");
  lines.push(
    `Thanks for choosing USA Gummies. Your wholesale order is captured below, and the onboarding documents your AP team will need are attached.`,
  );
  lines.push("");

  lines.push("Your order:");
  lines.push(orderBlock);
  lines.push("");

  lines.push(`Payment terms: ${netTerms}`);
  lines.push("");

  lines.push(attachmentList);
  lines.push("");

  lines.push("Next step on your side:");
  lines.push(
    `1. Review the invoice draft and confirm the order details look right.`,
  );
  lines.push(
    `2. Have your AP team complete the New Customer Setup Form (NCS-001) and return it to us.`,
  );
  lines.push(`   Reply to this email with the completed PDF, OR upload it at:`);
  lines.push(`   ${uploadUrl}`);
  lines.push(
    `3. Keep the Customer Information Form (CIF-001) on file for your records — it has our W-9 details + ACH routing for setting us up as a vendor in your system.`,
  );
  lines.push("");

  lines.push(
    `Once we receive your completed NCS-001, we'll finalize your customer profile in our system and send the official invoice. We can ship as soon as the order is confirmed — the NCS-001 doesn't block shipment, only the AP profile completion.`,
  );
  lines.push("");

  // Phase 36.5 — canonical escalation clause. Locks the launch order's
  // pricing without committing to forever-locked reorder pricing.
  // Single source: src/lib/finance/escalation-language.ts.
  lines.push("Pricing terms:");
  lines.push(STANDARD_ESCALATION_CLAUSE);
  lines.push("");

  lines.push(
    `Any questions, reply to this email or call ${SENDER_PHONE}.`,
  );
  lines.push("");

  lines.push("Thanks,");
  lines.push("Ben Stutman");
  lines.push("USA Gummies");
  lines.push(SENDER_EMAIL);
  lines.push(SENDER_PHONE);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Order block
// ---------------------------------------------------------------------------

function renderOrderBlock(
  state: OnboardingState,
  ctx: ApPacketEmailContext,
): string {
  const lines: string[] = [];
  let computedTotal = 0;

  for (const line of state.orderLines) {
    const tierLabel = TIER_INVOICE_LABEL[line.tier];
    const unit = unitNoun(line.tier, line.unitCount);
    const subtotal = line.subtotalUsd.toFixed(2);
    lines.push(
      `  - ${tierLabel} x ${line.unitCount} ${unit} (${line.bags} bags total) = $${subtotal}`,
    );
    computedTotal += line.subtotalUsd;
    if (line.customFreightRequired) {
      lines.push(
        `      (Custom freight quote required at 3+ pallets - we will follow up separately.)`,
      );
    }
  }

  const total =
    typeof ctx.totalUsdOverride === "number"
      ? ctx.totalUsdOverride
      : Math.round(computedTotal * 100) / 100;

  lines.push("");
  lines.push(`  Total: $${total.toFixed(2)}`);

  return lines.join("\n");
}

function renderAttachmentList(labels: readonly string[]): string {
  if (labels.length === 0) {
    return "Attachments: (none — flag this; the packet should have at least the NCS-001 + CIF-001 + invoice).";
  }
  const lines: string[] = [];
  lines.push(
    `${labels.length} document${labels.length === 1 ? "" : "s"} attached:`,
  );
  for (const label of labels) {
    lines.push(`  - ${label}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstName(contactName: string): string {
  const trimmed = contactName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

function unitNoun(
  tier: keyof typeof TIER_DISPLAY,
  count: number,
): string {
  const plural = count !== 1;
  switch (tier) {
    case "B1":
      return plural ? "cases" : "case";
    case "B2":
    case "B3":
      return plural ? "master cartons" : "master carton";
    case "B4":
    case "B5":
      return plural ? "pallets" : "pallet";
  }
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  DEFAULT_NET_TERMS,
  DEFAULT_UPLOAD_URL,
  SENDER_PHONE,
  SENDER_EMAIL,
  buildSubject,
  renderOrderBlock,
  renderAttachmentList,
  firstName,
  unitNoun,
};
