/**
 * Phase 37.6.a — Slack Approval Card builder tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.5a:
 *   - Card has the spec'd top-down section order: header → context →
 *     [validator if present] → strategic frame → draft → actions.
 *   - Validator block omitted when report.ok && warnings.length === 0.
 *   - Validator block included with hard-blockers when present.
 *   - Action ids match the spec format: email_<verb>_<draft_id>.
 *   - Approve button is style=primary on clean validator + B class.
 *   - Approve button has NO style + label "(blocked)" when validator
 *     reports hard-blockers.
 *   - Class C/D add a `confirm` dialog to the Approve button.
 *   - approvalCardChannel routes B → ops-approvals, C/D → financials.
 *   - parseEmailActionId round-trips correctly + rejects non-email ids.
 *   - Long draft body truncates with a "(truncated)" footer.
 */
import { describe, expect, it } from "vitest";

import {
  ACTION_ID_APPROVE,
  ACTION_ID_DENY,
  ACTION_ID_EDIT,
  approvalCardChannel,
  buildApprovalCard,
  parseEmailActionId,
} from "../approval-card";
import { buildStrategicFrame } from "../strategic-frame";
import { validateDraft } from "../validator";
import type { ClassifiedRecord } from "../classifier";
import type { ScanStatus } from "../inbox-scanner";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function classified(
  partial: Partial<ClassifiedRecord> = {},
): ClassifiedRecord {
  return {
    messageId: "msg-1",
    threadId: "thr-1",
    fromEmail: "buyer@christmasmouse.com",
    fromHeader: "Buyer <buyer@christmasmouse.com>",
    subject: "Sample request",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    status: "classified" as ScanStatus,
    noiseReason: "",
    observedAt: "2026-04-30T20:00:00.000Z",
    category: "A_sample_request",
    confidence: 0.88,
    ruleId: "legacy:sample-request",
    classificationReason: "Sample request keywords",
    classifiedAt: "2026-04-30T20:01:00.000Z",
    ...partial,
  };
}

const cleanDraft =
  "Hi Buyer — happy to send a sample case of our All American Gummy Bears " +
  "(7.5 oz). Should ship out from WA early next week. Anything specific you'd " +
  "like me to include?\n\nBest,\nBen Stutman";

function cleanCard(overrides: { draftBody?: string; classLevel?: "B" | "C" | "D" } = {}) {
  const record = classified();
  const frame = buildStrategicFrame({ record });
  const validation = validateDraft({
    body: overrides.draftBody ?? cleanDraft,
    isColdOutreach: true,
  });
  return buildApprovalCard({
    draftId: "draft-001",
    recipient: record.fromEmail,
    subject: record.subject,
    draftBody: overrides.draftBody ?? cleanDraft,
    frame,
    validation,
    category: record.category,
    classLevel: overrides.classLevel ?? "B",
  });
}

// ---------------------------------------------------------------------------
// Section order
// ---------------------------------------------------------------------------

describe("approval-card / section order", () => {
  it("has the spec'd top-down structure for a clean B-class draft", () => {
    const card = cleanCard();
    const types = card.blocks.map((b) => b.type as string);
    // Header → section (context) → divider → section (frame) → divider →
    // section (draft) → divider → actions
    // (no validator block when validation passes cleanly)
    expect(types[0]).toBe("header");
    expect(types[1]).toBe("section");
    expect(types[2]).toBe("divider");
    expect(types[3]).toBe("section"); // strategic frame
    expect(types[4]).toBe("divider");
    expect(types[5]).toBe("section"); // draft body
    expect(types[6]).toBe("divider");
    expect(types[7]).toBe("actions");
    expect(types).toHaveLength(8);
  });

  it("inserts validator block + divider when blockers exist", () => {
    const record = classified();
    const frame = buildStrategicFrame({ record });
    const validation = validateDraft({
      body: "Kosher gummies at $2.10/bag", // both compliance + pricing blockers
    });
    const card = buildApprovalCard({
      draftId: "draft-002",
      recipient: record.fromEmail,
      subject: record.subject,
      draftBody: "Kosher gummies at $2.10/bag",
      frame,
      validation,
      category: record.category,
      classLevel: "B",
    });
    const types = card.blocks.map((b) => b.type as string);
    // header → context → divider → validator → divider → frame → divider
    // → draft → divider → actions
    expect(types).toHaveLength(10);
    expect(types[3]).toBe("section"); // validator block
    const validatorText =
      ((card.blocks[3] as Record<string, unknown>).text as Record<string, string>).text;
    expect(validatorText).toContain("hard-block finding");
    expect(validatorText).toContain("compliance.kosher");
  });

  it("includes warnings (cold outreach missing anchor) without blockers", () => {
    // Missing both anchors → warning only.
    const record = classified();
    const frame = buildStrategicFrame({ record });
    const validation = validateDraft({
      body: "Hi — would you like to chat?",
      isColdOutreach: true,
    });
    expect(validation.ok).toBe(true);
    expect(validation.warnings.length).toBeGreaterThan(0);
    const card = buildApprovalCard({
      draftId: "draft-003",
      recipient: record.fromEmail,
      subject: record.subject,
      draftBody: "Hi — would you like to chat?",
      frame,
      validation,
      category: record.category,
      classLevel: "B",
    });
    const types = card.blocks.map((b) => b.type as string);
    // Validator block IS included (because warnings non-empty).
    expect(types).toHaveLength(10);
    const validatorText =
      ((card.blocks[3] as Record<string, unknown>).text as Record<string, string>).text;
    expect(validatorText).toContain("warning");
    expect(validatorText).toContain("anchor.missing");
  });
});

// ---------------------------------------------------------------------------
// Action ids
// ---------------------------------------------------------------------------

describe("approval-card / action ids", () => {
  it("emits email_<verb>_<draft_id> per spec", () => {
    const card = cleanCard();
    expect(card.actionIds).toEqual({
      approve: "email_approve_draft-001",
      deny: "email_deny_draft-001",
      edit: "email_edit_draft-001",
    });
    // Embedded in the actions block too.
    const actions = (card.blocks.at(-1) as Record<string, unknown>);
    expect(actions.type).toBe("actions");
    const elements = actions.elements as Array<{
      action_id: string;
      text: { text: string };
    }>;
    expect(elements[0].action_id).toBe("email_approve_draft-001");
    expect(elements[1].action_id).toBe("email_deny_draft-001");
    expect(elements[2].action_id).toBe("email_edit_draft-001");
  });

  it("constants exposed for the webhook handler (37.6.b)", () => {
    expect(ACTION_ID_APPROVE).toBe("email_approve");
    expect(ACTION_ID_DENY).toBe("email_deny");
    expect(ACTION_ID_EDIT).toBe("email_edit");
  });
});

describe("approval-card / parseEmailActionId", () => {
  it("round-trips approve/deny/edit", () => {
    expect(parseEmailActionId("email_approve_draft-001")).toEqual({
      verb: "approve",
      draftId: "draft-001",
    });
    expect(parseEmailActionId("email_deny_draft-001")).toEqual({
      verb: "deny",
      draftId: "draft-001",
    });
    expect(parseEmailActionId("email_edit_draft-001")).toEqual({
      verb: "edit",
      draftId: "draft-001",
    });
  });

  it("handles draft ids that contain underscores", () => {
    const out = parseEmailActionId("email_approve_msg-1_2026-05-01");
    expect(out).toEqual({ verb: "approve", draftId: "msg-1_2026-05-01" });
  });

  it("returns null for non-email action ids", () => {
    expect(parseEmailActionId("approval_unrelated_42")).toBeNull();
    expect(parseEmailActionId("email_unknown_draft-001")).toBeNull();
    expect(parseEmailActionId("totally_random_string")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approve button styling
// ---------------------------------------------------------------------------

describe("approval-card / Approve button styling", () => {
  it("style=primary + 'Approve' label on clean B-class card", () => {
    const card = cleanCard();
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    const approve = elements[0];
    expect(approve.style).toBe("primary");
    expect((approve.text as Record<string, string>).text).toBe("✅ Approve");
  });

  it("no style + 'blocked' label when validator reports hard-blockers", () => {
    const record = classified();
    const frame = buildStrategicFrame({ record });
    const validation = validateDraft({ body: "Kosher product." });
    const card = buildApprovalCard({
      draftId: "draft-blocked",
      recipient: record.fromEmail,
      subject: record.subject,
      draftBody: "Kosher product.",
      frame,
      validation,
      category: record.category,
      classLevel: "B",
    });
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    const approve = elements[0];
    expect(approve.style).toBeUndefined();
    expect((approve.text as Record<string, string>).text).toContain(
      "blocked",
    );
  });

  it("Class C adds 'needs Rene too' label + confirm dialog", () => {
    const card = cleanCard({ classLevel: "C" });
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    const approve = elements[0];
    expect((approve.text as Record<string, string>).text).toContain(
      "needs Rene",
    );
    expect(approve.confirm).toBeDefined();
  });

  it("Class D adds 'counsel loop' label + confirm dialog", () => {
    const card = cleanCard({ classLevel: "D" });
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    const approve = elements[0];
    expect((approve.text as Record<string, string>).text).toContain(
      "counsel loop",
    );
    expect(approve.confirm).toBeDefined();
  });

  it("Class B does NOT add a confirm dialog (one-tap)", () => {
    const card = cleanCard({ classLevel: "B" });
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    expect(elements[0].confirm).toBeUndefined();
  });

  it("Deny button always style=danger", () => {
    const card = cleanCard();
    const elements = (card.blocks.at(-1) as Record<string, unknown>)
      .elements as Array<Record<string, unknown>>;
    const deny = elements[1];
    expect(deny.style).toBe("danger");
  });
});

// ---------------------------------------------------------------------------
// Channel routing
// ---------------------------------------------------------------------------

describe("approval-card / approvalCardChannel", () => {
  it("Class B → #ops-approvals (default)", () => {
    expect(approvalCardChannel("B")).toBe("#ops-approvals");
  });

  it("Class C → #financials (default)", () => {
    expect(approvalCardChannel("C")).toBe("#financials");
  });

  it("Class D → #financials (default)", () => {
    expect(approvalCardChannel("D")).toBe("#financials");
  });
});

// ---------------------------------------------------------------------------
// Draft body
// ---------------------------------------------------------------------------

describe("approval-card / draft body", () => {
  // Helper: find the draft-body block (the one whose text starts with the
  // DRAFT REPLY header). Robust against block-order shifts when validator
  // warnings/blockers are or aren't inserted.
  function findDraftBlock(
    blocks: Array<Record<string, unknown>>,
  ): { text: string } {
    for (const b of blocks) {
      const t = (b.text as Record<string, string> | undefined)?.text ?? "";
      if (t.startsWith("*📝 DRAFT REPLY*")) return { text: t };
    }
    throw new Error("Draft block not found in card.blocks");
  }

  it("preserves the body verbatim in a code block", () => {
    const card = cleanCard();
    const { text } = findDraftBlock(card.blocks as Array<Record<string, unknown>>);
    expect(text).toContain("DRAFT REPLY");
    expect(text).toContain("All American Gummy Bears");
  });

  it("truncates at ~2900 chars and appends a (truncated) footer", () => {
    const long = "A".repeat(5000);
    const card = cleanCard({ draftBody: long });
    const { text } = findDraftBlock(card.blocks as Array<Record<string, unknown>>);
    expect(text.length).toBeLessThan(3100); // section limit safety
    expect(text).toContain("truncated for Slack");
  });
});

// ---------------------------------------------------------------------------
// Fallback text
// ---------------------------------------------------------------------------

describe("approval-card / fallback text", () => {
  it("includes class + recipient + subject", () => {
    const card = cleanCard({ classLevel: "B" });
    expect(card.text).toContain("(B)");
    expect(card.text).toContain("Sample request");
    expect(card.text).toContain("buyer@christmasmouse.com");
  });
});
