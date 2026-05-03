/**
 * Slack Block Kit renderer for Viktor's W-9 finance close-loop trigger.
 *
 * Triggered when Rene says one of the canonical close phrases in
 * `#financials` ("prepare booke to complete" / "is booke next" / etc.)
 * — Viktor responds with the readiness state + To Review queue depth +
 * a doctrine reminder.
 *
 * Pure module (no I/O); the events handler does the live fetch and
 * passes the rendered state in.
 *
 * Doctrine compliance per /contracts/slack-card-doctrine.md v1.0:
 *   - Header w/ posture chip
 *   - Stats fields (configured? / queue depth / posture)
 *   - Brief block adapts to configured vs not-configured
 *   - Read-only context: "no QBO write fires from this card"
 *   - Action buttons: open runbook / open viktor.md
 */
import type { BookeUnreviewedTransaction } from "./booke-client";

const RUNBOOK_URL =
  "https://github.com/USAGummies/usagummies-storefront/blob/main/contracts/booke-integration-runbook.md";
const VIKTOR_DOCTRINE_URL =
  "https://github.com/USAGummies/usagummies-storefront/blob/main/contracts/viktor.md";

export interface ViktorW9CardArgs {
  /** True iff `BOOKE_API_TOKEN` is set in env. */
  configured: boolean;
  /**
   * When configured + read succeeded, the To Review queue rows. Empty
   * array is a valid value (means "configured + queue is empty").
   */
  toReviewRows: ReadonlyArray<BookeUnreviewedTransaction>;
  /**
   * When configured but the read failed, the reason string. Surfaces
   * to Rene as a degraded warning (don't claim "queue is empty" on a
   * fetch error).
   */
  readError?: string | null;
  /** ISO. */
  generatedAt?: string;
}

export interface ViktorW9Card {
  text: string;
  blocks: unknown[];
}

export function renderViktorW9Card(args: ViktorW9CardArgs): ViktorW9Card {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const posture = derivePosture(args);
  const postureChip = postureLabel(posture);
  const queueCount = args.toReviewRows.length;

  const text = !args.configured
    ? `📚 Booke close-loop — ${postureChip} access not configured`
    : args.readError
      ? `📚 Booke close-loop — ${postureChip} read failed`
      : queueCount === 0
        ? `📚 Booke close-loop — ${postureChip} queue empty`
        : `📚 Booke close-loop — ${postureChip} ${queueCount} to review`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📚 Booke close-loop — ${postureChip}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Access*\n${args.configured ? "✅ configured" : "❌ not configured"}`,
        },
        {
          type: "mrkdwn",
          text: `*Queue depth*\n${args.configured && !args.readError ? queueCount : "—"}`,
        },
        {
          type: "mrkdwn",
          text: `*Doctrine*\nviktor.md v3.2 W-9`,
        },
        {
          type: "mrkdwn",
          text: `*Approval class*\nB (Rene approves)`,
        },
        {
          type: "mrkdwn",
          text: `*Closed-period rule*\nDR COGS / CR Retained Earnings`,
        },
        {
          type: "mrkdwn",
          text: `*Account family*\n5000-only by default`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(args, queueCount) },
    },
  ];

  if (args.configured && !args.readError && args.toReviewRows.length > 0) {
    const top = args.toReviewRows.slice(0, 5);
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Top ${top.length} To Review*\n` +
          top.map(formatRow).join("\n"),
      },
    });
  }

  if (args.configured && args.readError) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚨 Booke read failed*\n\`${truncate(args.readError, 200)}\`\n_Operator should check the BOOKE_API_TOKEN value + Booke API status before continuing._`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Generated ${formatShortTime(generatedAt)} · Read-only — no QBO write fires from this card · Class B \`booke.category.apply\` requires Rene approval; Class C \`qbo.journal_entry.post\` requires Ben + Rene`,
      },
    ],
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: args.configured ? "Open viktor.md doctrine" : "Open access runbook",
          emoji: true,
        },
        url: args.configured ? VIKTOR_DOCTRINE_URL : RUNBOOK_URL,
        action_id: "open_viktor_w9_doc",
      },
      ...(args.configured
        ? [
            {
              type: "button",
              text: { type: "plain_text", text: "Open access runbook", emoji: true },
              url: RUNBOOK_URL,
              action_id: "open_booke_runbook",
            },
          ]
        : []),
    ],
  });

  return { text, blocks };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function derivePosture(
  args: Pick<ViktorW9CardArgs, "configured" | "toReviewRows" | "readError">,
): "green" | "yellow" | "red" | "unknown" {
  if (!args.configured) return "unknown";
  if (args.readError) return "red";
  if (args.toReviewRows.length === 0) return "green";
  return "yellow";
}

function postureLabel(p: "green" | "yellow" | "red" | "unknown"): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  if (p === "red") return "🔴 read failed";
  return "⚪️ not configured";
}

function buildBriefText(
  args: Pick<ViktorW9CardArgs, "configured" | "readError">,
  queueCount: number,
): string {
  if (!args.configured) {
    return (
      "_Booke API access is not configured yet. Operator must walk_ " +
      `<${RUNBOOK_URL}|/contracts/booke-integration-runbook.md>_ ` +
      "_(4 steps, ~5 min). Until then I can read Booke's queue count via the legacy KV path but cannot pull individual To Review rows or apply categories._"
    );
  }
  if (args.readError) {
    return "*🚨 Booke API read failed.* I'm pausing the W-9 close-loop until the operator restores access. Surfacing the error string above for triage.";
  }
  if (queueCount === 0) {
    return "_Booke To Review queue is empty._ Ready for the next phase: BoA bank rec → Capital One CC rec → reconnect Platinum after April rec is clean.";
  }
  return (
    `*${queueCount} To Review row${queueCount === 1 ? "" : "s"}.*` +
    " I'll propose category mappings + surface discrepancies for Rene's line-by-line approval. " +
    "Hard rules per W-9: nothing in 6000/7000 unless Rene says so · one bank-matching JE per Amazon deposit · selling fees → channel MSF (500040.05) · closed-period cleanup → DR COGS / CR Retained Earnings."
  );
}

function formatRow(r: BookeUnreviewedTransaction): string {
  const vendor = r.vendor ? truncate(r.vendor, 30) : "(no vendor)";
  const amount = `$${Math.abs(r.amount).toFixed(2)}`;
  const suggestion = r.suggestedCategory
    ? ` → \`${truncate(r.suggestedCategory, 30)}\``
    : "";
  return `• ${vendor} · ${amount} · _${truncate(r.source, 12)}_${suggestion}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 16) + "Z";
  } catch {
    return iso;
  }
}
