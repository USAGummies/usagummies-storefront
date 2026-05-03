/**
 * Sample Touch-2 Class B approval card renderer.
 *
 * Markdown body shown on the #ops-approvals card before Ben taps
 * Approve. Surfaces the deal context (HubSpot deal id, days since
 * shipped), buyer email, draft subject + body preview, source
 * citations (which deal / queue snapshot triggered the candidate).
 *
 * Pairs with the email-reply Class B closer (executeApprovedEmailReply)
 * — same `gmail.send` slug, same `targetEntity.type: "email-reply"`,
 * same payloadRef pattern as reorder-offer. The closer fires the
 * Gmail draft on approve and logs the engagement to the HubSpot
 * contact's timeline automatically.
 */

export interface SampleTouch2CardInput {
  /** HubSpot deal id (stable identifier). */
  hubspotDealId: string;
  /** Display name for the card label. */
  displayName: string;
  /** Buyer email — verified by caller before invocation. */
  buyerEmail: string;
  /** Days since the sample shipped. */
  daysSinceShipped: number;
  /** Subject line of the prepared draft. */
  subject: string;
  /** Full body (preview is truncated). */
  body: string;
  /** Source citations — typically [{system: "hubspot:deal", id: dealId}]. */
  sources?: Array<{ system: string; id?: string; url?: string }>;
}

const PREVIEW_LIMIT = 280;

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "ʹ");
}

function previewBody(body: string): string {
  const collapsed = body.replace(/\n{2,}/g, "\n").trim();
  if (collapsed.length <= PREVIEW_LIMIT) return collapsed;
  return collapsed.slice(0, PREVIEW_LIMIT - 1).trimEnd() + "…";
}

export function renderSampleTouch2Card(
  input: SampleTouch2CardInput,
): string {
  const lines = [
    `:eyes: *Sample Touch-2 — checking in on a sample shipment*`,
    `*Buyer:* ${input.displayName} (\`${input.buyerEmail}\`)`,
    `*HubSpot deal:* \`${input.hubspotDealId}\``,
    `*Days since sample shipped:* ${input.daysSinceShipped}`,
    `*Subject:* ${escapeBackticks(input.subject)}`,
    "",
    "*Body preview:*",
    "```",
    previewBody(input.body),
    "```",
  ];

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
    `_Class B \`gmail.send\`. Approve in <#C0ATWJDHS74|ops-approvals> → Gmail draft sends from ben@usagummies.com → HubSpot timeline log on the contact._`,
  );

  return lines.join("\n");
}
