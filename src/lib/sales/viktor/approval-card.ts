/**
 * Phase 37.6.a — Slack Interactive Approval Card builder (Viktor capability).
 *
 * Pure Block Kit JSON builder per /contracts/email-agents-system.md §2.5a.
 * The actual `chat.postMessage` call is owned by the runtime drafter
 * (37.11) — this module is the data layer.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - PURE function, no I/O, no Slack API call.
 *   - Card structure (top-down): Header (category + class) → Recipient
 *     + Subject context → Validator findings (if any) → Strategic
 *     Framework section → Draft reply preview → Action row.
 *   - Action ids per spec: `email_approve_<draft_id>`, `email_deny_<draft_id>`,
 *     `email_edit_<draft_id>`.
 *   - Validator hard-block findings DISABLE the Approve button at the
 *     UI layer (informational — the webhook handler in 37.6.b is the
 *     real gate). The Edit + Deny buttons remain enabled.
 *   - Strategic Framework section uses `renderStrategicFrameForCard()`
 *     from 37.5 to keep doctrine consistent across surfaces.
 *
 * Phase 37.6.b (interactivity webhook) and 37.6.c (edit-via-LLM modal)
 * are separate commits — they're stateful surfaces that touch network
 * + LLM and warrant their own atomic ships.
 */
import { renderStrategicFrameForCard, type StrategicFrame } from "./strategic-frame";
import type { ValidationReport } from "./validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Approval class per /contracts/email-agents-system.md §2.5. Drives:
 *   - The card emoji/header color
 *   - Whether the card lands in #ops-approvals (B) or #finance (C/D)
 *   - The Approve button label ("Approve" vs "Approve · Class C — needs Rene too")
 */
export type ApprovalClass = "B" | "C" | "D";

export interface ApprovalCardInput {
  /** Stable id for the draft — embedded into action_ids so the webhook
   *  handler can look up the draft. Caller-supplied (typically a slug
   *  derived from messageId + timestamp). */
  draftId: string;
  /** Recipient email (To: line). */
  recipient: string;
  /** Subject of the draft. */
  subject: string;
  /** Plain-text body of the draft. Markdown is preserved verbatim. */
  draftBody: string;
  /** Strategic Framework from Phase 37.5 — required by doctrine §2.5b. */
  frame: StrategicFrame;
  /** Validator report from Phase 37.4 — required by doctrine §2.4. */
  validation: ValidationReport;
  /** Email category from the classifier (Phase 37.2). Used for header label. */
  category: string;
  /** Approval class — B/C/D. Drives header label + button captions. */
  classLevel: ApprovalClass;
  /** Optional category-specific tagline displayed under the header. */
  contextLine?: string;
}

/**
 * Slack Block Kit blocks. We use a permissive type (unknown[]) at the
 * boundary because block payloads are deeply structured and Block Kit's
 * full schema isn't worth importing for a 100-line module. Tests assert
 * structure shape directly.
 */
export type SlackBlock = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Approve / Deny / Edit action_id format per §2.5a:
 *   `email_approve_<draft_id>`
 *   `email_deny_<draft_id>`
 *   `email_edit_<draft_id>`
 *
 * Webhook handler (37.6.b) parses these to look up the draft.
 */
export const ACTION_ID_APPROVE = "email_approve";
export const ACTION_ID_DENY = "email_deny";
export const ACTION_ID_EDIT = "email_edit";

/** Per-class header tagline. */
const CLASS_LABEL: Record<ApprovalClass, string> = {
  B: "Class B — Ben single-approve",
  C: "Class C — Ben + Rene approval",
  D: "Class D — HUMAN ONLY (legal / whale / multi-year)",
};

/** Slack message-text fallback (used when blocks don't render — old clients,
 *  notification preview, etc.). */
function buildFallbackText(opts: ApprovalCardInput): string {
  return `📧 Email draft (${opts.classLevel}): ${opts.subject} → ${opts.recipient}`;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function headerBlock(opts: ApprovalCardInput): SlackBlock {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: `📧 EMAIL DRAFT — ${opts.category} (${CLASS_LABEL[opts.classLevel]})`,
      emoji: true,
    },
  };
}

function contextBlock(opts: ApprovalCardInput): SlackBlock {
  const parts: string[] = [];
  parts.push(`*To:* ${opts.recipient}`);
  parts.push(`*Subject:* ${opts.subject}`);
  if (opts.contextLine) parts.push(`_${opts.contextLine}_`);
  return {
    type: "section",
    text: { type: "mrkdwn", text: parts.join("\n") },
  };
}

function dividerBlock(): SlackBlock {
  return { type: "divider" };
}

/**
 * Validator findings — inserted only when blockers OR warnings exist.
 * Hard-blockers get a leading 🚫; warnings get ⚠️. Empty otherwise.
 */
function validatorBlock(report: ValidationReport): SlackBlock | null {
  if (report.ok && report.warnings.length === 0) return null;
  const lines: string[] = [];
  if (report.blockers.length > 0) {
    lines.push(`🚫 *Validator: ${report.blockers.length} hard-block finding(s)*`);
    for (const b of report.blockers) {
      lines.push(`  • [${b.class}/${b.ruleId}] ${b.message}`);
    }
  }
  if (report.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`⚠️ *${report.warnings.length} warning(s)*`);
    for (const w of report.warnings) {
      lines.push(`  • [${w.class}/${w.ruleId}] ${w.message}`);
    }
  }
  return {
    type: "section",
    text: { type: "mrkdwn", text: lines.join("\n") },
  };
}

function strategicFrameBlock(frame: StrategicFrame): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text: renderStrategicFrameForCard(frame) },
  };
}

/**
 * Draft body block — Slack `mrkdwn` with the body wrapped to preserve
 * preformatted whitespace. Caps at ~3000 chars per Slack section limit.
 */
function draftBodyBlock(body: string): SlackBlock {
  const MAX = 2900;
  const trimmed =
    body.length <= MAX ? body : body.slice(0, MAX) + "\n\n_…(truncated for Slack — full draft in approval payload)_";
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*📝 DRAFT REPLY*\n\`\`\`\n${trimmed}\n\`\`\``,
    },
  };
}

/**
 * Action row — three buttons. Approve is `style=primary` when validator
 * passes, default style when blockers exist. Deny is `style=danger`.
 *
 * Per spec §2.5a: action_id format is `email_<verb>_<draft_id>`.
 */
function actionsBlock(opts: ApprovalCardInput): SlackBlock {
  const approveDisabled = !opts.validation.ok;
  const approveLabel = approveDisabled
    ? "✅ Approve (blocked — see findings)"
    : opts.classLevel === "C"
      ? "✅ Approve (Class C — needs Rene too)"
      : opts.classLevel === "D"
        ? "✅ Approve (Class D — counsel loop required)"
        : "✅ Approve";

  return {
    type: "actions",
    block_id: `email_actions_${opts.draftId}`,
    elements: [
      {
        type: "button",
        action_id: `${ACTION_ID_APPROVE}_${opts.draftId}`,
        text: { type: "plain_text", text: approveLabel, emoji: true },
        value: opts.draftId,
        ...(approveDisabled ? {} : { style: "primary" }),
        // Slack's `confirm` dialog adds an extra-confirm step for high-stakes
        // actions. Wired here for Class C/D only — Class B is one-tap.
        ...(opts.classLevel === "C" || opts.classLevel === "D"
          ? {
              confirm: {
                title: { type: "plain_text", text: "Confirm approval" },
                text: {
                  type: "mrkdwn",
                  text: `This is a *${CLASS_LABEL[opts.classLevel]}* send. Are you sure?`,
                },
                confirm: { type: "plain_text", text: "Yes, send" },
                deny: { type: "plain_text", text: "Cancel" },
              },
            }
          : {}),
      },
      {
        type: "button",
        action_id: `${ACTION_ID_DENY}_${opts.draftId}`,
        text: { type: "plain_text", text: "❌ Deny", emoji: true },
        value: opts.draftId,
        style: "danger",
      },
      {
        type: "button",
        action_id: `${ACTION_ID_EDIT}_${opts.draftId}`,
        text: { type: "plain_text", text: "✏️ Edit (LLM)", emoji: true },
        value: opts.draftId,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ApprovalCard {
  /** Block Kit blocks payload — drop into postMessage({channel, blocks}). */
  blocks: SlackBlock[];
  /** Fallback text for notifications + old clients. */
  text: string;
  /** Action ids embedded into the card — useful for tests + webhook lookup. */
  actionIds: {
    approve: string;
    deny: string;
    edit: string;
  };
}

/**
 * Build the full Block Kit approval-card payload from a draft + frame +
 * validation report. Pure function — call it once and pass `blocks` +
 * `text` to `postMessage()`.
 *
 * Per spec §2.5a: caller routes the resulting payload to:
 *   - `#ops-approvals` for Class B
 *   - `#finance` for Class C / D
 */
export function buildApprovalCard(opts: ApprovalCardInput): ApprovalCard {
  const blocks: SlackBlock[] = [];
  blocks.push(headerBlock(opts));
  blocks.push(contextBlock(opts));
  blocks.push(dividerBlock());

  const validatorB = validatorBlock(opts.validation);
  if (validatorB) {
    blocks.push(validatorB);
    blocks.push(dividerBlock());
  }

  blocks.push(strategicFrameBlock(opts.frame));
  blocks.push(dividerBlock());
  blocks.push(draftBodyBlock(opts.draftBody));
  blocks.push(dividerBlock());
  blocks.push(actionsBlock(opts));

  return {
    blocks,
    text: buildFallbackText(opts),
    actionIds: {
      approve: `${ACTION_ID_APPROVE}_${opts.draftId}`,
      deny: `${ACTION_ID_DENY}_${opts.draftId}`,
      edit: `${ACTION_ID_EDIT}_${opts.draftId}`,
    },
  };
}

/**
 * Helper: route an approval card to the correct Slack channel based on
 * the approval class. The channel name (with leading `#`) is returned;
 * caller passes it to `postMessage`. Channels are configurable via env
 * for staging.
 *
 * Defaults:
 *   - Class B → `#ops-approvals`
 *   - Class C → `#finance`
 *   - Class D → `#finance` (operator pings counsel manually)
 */
export function approvalCardChannel(classLevel: ApprovalClass): string {
  if (classLevel === "C" || classLevel === "D") {
    return process.env.SLACK_CHANNEL_FINANCE_NAME ?? process.env.SLACK_CHANNEL_FINANCIALS_NAME ?? "#finance";
  }
  return process.env.SLACK_CHANNEL_OPS_APPROVALS_NAME ?? "#ops-approvals";
}

/**
 * Parse an action_id back into `{verb, draftId}`. Used by the
 * interactivity webhook handler (Phase 37.6.b) to dispatch on click.
 *
 * Returns null when the id doesn't match the email-action shape.
 */
export function parseEmailActionId(
  actionId: string,
): { verb: "approve" | "deny" | "edit"; draftId: string } | null {
  const m = actionId.match(/^email_(approve|deny|edit)_(.+)$/);
  if (!m) return null;
  return { verb: m[1] as "approve" | "deny" | "edit", draftId: m[2] };
}
