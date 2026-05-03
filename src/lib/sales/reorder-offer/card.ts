/**
 * Reorder-offer Class B approval card renderer.
 *
 * Markdown body shown on the #ops-approvals card before Ben taps
 * Approve. Surfaces:
 *   - channel + buyer + days-since-last-order
 *   - subject preview
 *   - first 200 chars of the body
 *   - discount code (DTC only) when provided
 *   - source citation footer (where the candidate came from)
 *
 * Pairs with the email-reply Class B closer (executeApprovedEmailReply)
 * — both use targetEntity.type "email-reply" and the existing
 * gmail.send taxonomy slug, so on approve the standard Gmail draft
 * send + HubSpot timeline log fires automatically.
 */
import type { ReorderChannel } from "../reorder-followup";

export interface ReorderOfferCardInput {
  channel: ReorderChannel;
  candidateId: string;
  displayName: string;
  buyerEmail: string;
  daysSinceLastOrder: number;
  windowDays: number;
  /** Subject line of the prepared draft. */
  subject: string;
  /** Full body (preview is truncated). */
  body: string;
  template: string;
  /** Discount code (DTC only). Rendered when present. */
  discountCode?: string;
  /** Source citations — where the candidate came from. */
  sources?: Array<{ system: string; id?: string; url?: string }>;
}

const PREVIEW_LIMIT = 240;

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "ʹ");
}

function previewBody(body: string): string {
  const collapsed = body.replace(/\n{2,}/g, "\n").trim();
  if (collapsed.length <= PREVIEW_LIMIT) return collapsed;
  return collapsed.slice(0, PREVIEW_LIMIT - 1).trimEnd() + "…";
}

function channelLabel(c: ReorderChannel): string {
  switch (c) {
    case "shopify-dtc":
      return "Shopify DTC";
    case "amazon-fbm":
      return "Amazon FBM";
    case "wholesale":
      return "Wholesale";
  }
}

export function renderReorderOfferCard(input: ReorderOfferCardInput): string {
  const lines = [
    `:repeat: *Reorder offer — ${channelLabel(input.channel)}*`,
    `*Buyer:* ${input.displayName} (\`${input.buyerEmail}\`)`,
    `*Days since last order:* ${input.daysSinceLastOrder} (window: ${input.windowDays}d)`,
    `*Subject:* ${escapeBackticks(input.subject)}`,
  ];

  if (input.discountCode) {
    lines.push(`*Discount code:* \`${input.discountCode}\``);
  }

  lines.push("");
  lines.push("*Body preview:*");
  lines.push("```");
  lines.push(previewBody(input.body));
  lines.push("```");

  if (input.sources && input.sources.length > 0) {
    lines.push("");
    lines.push("*Source:*");
    for (const s of input.sources) {
      const ref = s.url
        ? `<${s.url}|${s.id ?? s.system}>`
        : `\`${s.system}${s.id ? `:${s.id}` : ""}\``;
      lines.push(`  • ${ref}`);
    }
  }

  lines.push("");
  lines.push(
    `_Class B \`gmail.send\`. Approve in <#C0ATWJDHS74|ops-approvals> → Gmail draft sends from ben@usagummies.com → HubSpot logs the engagement on the contact._`,
  );

  return lines.join("\n");
}
