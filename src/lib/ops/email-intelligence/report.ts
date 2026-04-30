/**
 * Slack report renderer for the email-intelligence pipeline.
 *
 * Renders a single Slack message with sections in priority order:
 *   1. :rotating_light: Critical (shipping issues + AP/finance from a known retailer)
 *   2. :ballot_box_with_ballot: Needs approval (drafts ready to send)
 *   3. :memo: Drafts ready (Class A drafts saved in Gmail)
 *   4. :package: Sample requests
 *   5. :moneybag: Finance / AP
 *   6. :truck: Shipping issues
 *   7. :grey_exclamation: FYI / junk (collapsed count)
 *
 * The orchestrator builds a `RenderedReport` for #ops-daily and per-email
 * approval cards to #ops-approvals.
 */
import type { Classification, EmailCategory } from "./classifier";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

export interface ScannedEmail {
  envelope: EmailEnvelope;
  classification: Classification;
  /** True when the dedupe layer found prior engagement; we still surface but flag. */
  alreadyEngaged: boolean;
  /** True when we already created a Gmail draft for this message. */
  hasDraft: boolean;
  draftId?: string | null;
  /** True when an approval card has been posted to #ops-approvals. */
  hasApproval: boolean;
  approvalId?: string | null;
}

export interface ReportRollup {
  /** Total emails scanned in this cron tick (post-cursor). */
  scanned: number;
  /** Already-processed via KV; not re-scored. */
  skipped: number;
  /** Newly classified this run. */
  classified: number;
  byCategory: Record<EmailCategory, number>;
}

function senderName(env: EmailEnvelope): string {
  const m = env.from?.match(/^([^<]+)</);
  if (m) return m[1].trim();
  return env.from || "(unknown sender)";
}

function emailLine(s: ScannedEmail): string {
  const subject = (s.envelope.subject || "(no subject)").slice(0, 80);
  const sender = senderName(s.envelope);
  const status: string[] = [];
  if (s.alreadyEngaged) status.push(":eyes: prior engagement");
  if (s.hasDraft) status.push(":memo: draft");
  if (s.hasApproval) status.push(":ballot_box_with_ballot: approval pending");
  const tail = status.length ? `  _${status.join(" · ")}_` : "";
  return `• *${sender}* — ${subject}${tail}`;
}

function bucketEmails(scanned: ScannedEmail[]): Record<EmailCategory, ScannedEmail[]> {
  const buckets: Record<EmailCategory, ScannedEmail[]> = {
    customer_support: [],
    b2b_sales: [],
    ap_finance: [],
    vendor_supply: [],
    sample_request: [],
    shipping_issue: [],
    receipt_document: [],
    marketing_pr: [],
    junk_fyi: [],
  };
  for (const s of scanned) {
    buckets[s.classification.category].push(s);
  }
  return buckets;
}

/**
 * Render the full Slack report. Returns a string Markdown-style payload
 * for `chat.postMessage` `text` field.
 */
/**
 * Returns true iff the email-intel run produced any actionable signal —
 * i.e. anything outside the `junk_fyi` bucket. Used to suppress the
 * Slack post on no-actionable runs (which were ~70% of digests posting
 * `_Scanned 50, classified 1, FYI/junk (1) — collapsed_` to #ops-daily).
 *
 * Drafts-ready and receipts/docs DO count as actionable — Ben/Rene want
 * to know about new draft replies and incoming invoices.
 */
export function hasActionableSignal(scanned: ScannedEmail[]): boolean {
  if (!scanned.length) return false;
  const buckets = bucketEmails(scanned);
  const hasCritical =
    buckets.shipping_issue.length > 0 ||
    buckets.ap_finance.some((s) => s.alreadyEngaged);
  if (hasCritical) return true;
  if (scanned.some((s) => s.hasApproval || s.hasDraft)) return true;
  for (const k of [
    "sample_request",
    "ap_finance",
    "vendor_supply",
    "b2b_sales",
    "customer_support",
    "marketing_pr",
    "receipt_document",
  ] as const) {
    if (buckets[k].length > 0) return true;
  }
  return false;
}

export function renderEmailReport(opts: {
  scanned: ScannedEmail[];
  rollup: ReportRollup;
  windowDescription: string; // e.g. "since 12:00 PT (last 3 hours)"
}): string {
  const { scanned, rollup, windowDescription } = opts;
  const buckets = bucketEmails(scanned);
  const lines: string[] = [];

  lines.push(
    `📬 ⭐ *INBOX SWEEP — ${windowDescription}* ⭐`,
  );
  lines.push(
    `_${rollup.scanned} scanned · ${rollup.classified} classified · ${rollup.skipped} skipped (already in motion)_`,
  );
  lines.push("");

  // 1. Critical = shipping issues + ap/finance with prior engagement
  const critical = [
    ...buckets.shipping_issue,
    ...buckets.ap_finance.filter((s) => s.alreadyEngaged),
  ];
  if (critical.length > 0) {
    lines.push(`🚨 *CRITICAL — ALL HANDS (${critical.length})*`);
    for (const s of critical.slice(0, 8)) lines.push(emailLine(s));
    if (critical.length > 8) lines.push(`  …and ${critical.length - 8} more`);
    lines.push("");
  }

  // 2. Needs approval (drafts created + awaiting Slack click)
  const needsApproval = scanned.filter((s) => s.hasApproval);
  if (needsApproval.length > 0) {
    lines.push(`🛂 *AWAITING YOUR CALL (${needsApproval.length})*`);
    for (const s of needsApproval.slice(0, 8)) {
      lines.push(`${emailLine(s)} — _#ops-approvals card posted_`);
    }
    if (needsApproval.length > 8) lines.push(`  …and ${needsApproval.length - 8} more`);
    lines.push("");
  }

  // 3. Drafts ready (Class A draft saved, no approval needed)
  const draftsReady = scanned.filter(
    (s) => s.hasDraft && !s.hasApproval,
  );
  if (draftsReady.length > 0) {
    lines.push(`📝 *DRAFTS LOADED IN THE CHAMBER (${draftsReady.length})*`);
    for (const s of draftsReady.slice(0, 8)) lines.push(emailLine(s));
    if (draftsReady.length > 8) lines.push(`  …and ${draftsReady.length - 8} more`);
    lines.push("");
  }

  // 4. Sample requests
  if (buckets.sample_request.length > 0) {
    lines.push(`📦 *SAMPLE REQUESTS — SHIP TO IMPRESS (${buckets.sample_request.length})*`);
    for (const s of buckets.sample_request.slice(0, 8)) lines.push(emailLine(s));
    lines.push("");
  }

  // 5. AP / finance (non-critical)
  const apOnly = buckets.ap_finance.filter((s) => !s.alreadyEngaged);
  if (apOnly.length > 0) {
    lines.push(`💰 *FINANCE / AP (${apOnly.length})*`);
    for (const s of apOnly.slice(0, 8)) lines.push(emailLine(s));
    lines.push("");
  }

  // 6. Vendor supply
  if (buckets.vendor_supply.length > 0) {
    lines.push(`🏭 *VENDOR / SUPPLY CHAIN (${buckets.vendor_supply.length})*`);
    for (const s of buckets.vendor_supply.slice(0, 6)) lines.push(emailLine(s));
    lines.push("");
  }

  // 7. B2B sales
  if (buckets.b2b_sales.length > 0) {
    lines.push(`🤝 *B2B WHOLESALE — DEAL FLOW (${buckets.b2b_sales.length})*`);
    for (const s of buckets.b2b_sales.slice(0, 8)) lines.push(emailLine(s));
    lines.push("");
  }

  // 8. Customer support
  if (buckets.customer_support.length > 0) {
    lines.push(`🙋 *CUSTOMER CARE (${buckets.customer_support.length})*`);
    for (const s of buckets.customer_support.slice(0, 6)) lines.push(emailLine(s));
    lines.push("");
  }

  // 9. Marketing / PR
  if (buckets.marketing_pr.length > 0) {
    lines.push(`📰 *MARKETING / PR (${buckets.marketing_pr.length})*`);
    for (const s of buckets.marketing_pr.slice(0, 4)) lines.push(emailLine(s));
    lines.push("");
  }

  // 10. Receipts / docs (collapsed count + first few subjects)
  if (buckets.receipt_document.length > 0) {
    lines.push(`🧾 *RECEIPTS / DOCS (${buckets.receipt_document.length})*`);
    for (const s of buckets.receipt_document.slice(0, 4)) lines.push(emailLine(s));
    lines.push("");
  }

  // 11. Junk / FYI (count only)
  if (buckets.junk_fyi.length > 0) {
    lines.push(
      `🗂️ *Filed under noise (${buckets.junk_fyi.length})* — collapsed, no action needed`,
    );
    lines.push("");
  }

  if (rollup.classified === 0) {
    lines.push("✅ _Inbox is quiet — no actionable signal in this window. Carry on, soldier._");
  }

  return lines.join("\n");
}

/**
 * Render the per-email approval card body (text for #ops-approvals
 * Slack post). Used when the email is Class B and needs Ben's click.
 */
export function renderApprovalCard(opts: {
  scanned: ScannedEmail;
  draftBodyPreview: string;
}): string {
  const { scanned, draftBodyPreview } = opts;
  const env = scanned.envelope;
  const subject = env.subject || "(no subject)";
  const lines: string[] = [
    `:envelope: *Reply approval — ${senderName(env)}*`,
    `_Inbound: ${subject}_`,
    `Category: \`${scanned.classification.category}\` · Confidence: ${scanned.classification.confidence.toFixed(2)} · Rule: ${scanned.classification.ruleId}`,
    "",
    `*Inbound snippet:* ${(env.snippet || "").slice(0, 240)}`,
    "",
    `*Drafted reply (preview):*`,
    "```",
    draftBodyPreview.slice(0, 800),
    draftBodyPreview.length > 800 ? "…[truncated]" : "",
    "```",
    "",
    `_Approve in #ops-approvals → reply sends from ben@usagummies.com._`,
  ];
  return lines.filter(Boolean).join("\n");
}
